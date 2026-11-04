using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using SpServer.Data;
using SpServer.Domain;
using SpServer.Services;

var builder = WebApplication.CreateBuilder(args);

// 监听地址默认取 appsettings.json 的 Server:Host / Server:Port；
// 需要临时改端口时仍可用 --urls 或 ASPNETCORE_URLS 覆盖，命令行优先级更高。
var explicitUrls = builder.Configuration["urls"]
    ?? Environment.GetEnvironmentVariable("ASPNETCORE_URLS")
    ?? Environment.GetEnvironmentVariable("DOTNET_URLS");
if (string.IsNullOrWhiteSpace(explicitUrls))
{
    var host = builder.Configuration["Server:Host"];
    var port = builder.Configuration.GetValue("Server:Port", 5080);
    builder.WebHost.UseUrls($"http://{(string.IsNullOrWhiteSpace(host) ? "127.0.0.1" : host)}:{port}");
}

var connectionString = builder.Configuration.GetConnectionString("Db") ?? "Data Source=sp.db";
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlite(connectionString));
builder.Services.AddScoped<CreditService>();
builder.Services.AddSingleton<ModelGateway>();
builder.Services.AddSingleton<SpeechGateway>();
builder.Services.AddHttpClient("upstream", client => client.Timeout = TimeSpan.FromMinutes(5));

var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
{
    // 扩展来源是 chrome-extension://<id>，加载位置变化会导致 ID 变化，所以本地开发默认放开。
    // 正式对外前应收紧为固定的扩展 ID，并接 HTTPS。
    if (allowedOrigins is { Length: > 0 }) policy.WithOrigins(allowedOrigins);
    else policy.AllowAnyOrigin();
    policy.AllowAnyHeader().AllowAnyMethod();
}));

var app = builder.Build();
var logger = app.Logger;
app.UseCors();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    await db.SeedAsync();
}

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (ApiException ex)
    {
        context.Response.StatusCode = ex.StatusCode;
        await context.Response.WriteAsJsonAsync(new { code = ex.Code, message = ex.Message });
    }
});

app.MapGet("/health", () => new { ok = true, time = DateTime.UtcNow });

app.MapPost("/api/device/register", async (RegisterRequest req, AppDbContext db, CreditService credits,
    CancellationToken ct) =>
{
    var account = await credits.RegisterDeviceAsync(req.DeviceId, req.Label ?? "", ct);
    return Results.Ok(new { token = account.Token, balance = account.Balance, deviceId = account.DeviceId });
});

app.MapGet("/api/config", async (AppDbContext db, CreditService credits, CancellationToken ct) =>
{
    var policy = await credits.GetPolicyAsync(ct);
    var models = await db.Models.Where(m => m.IsEnabled).OrderBy(m => m.SortOrder).ToListAsync(ct);

    return Results.Ok(new
    {
        chatEnabled = policy.ChatEnabled,
        freeCredits = policy.FreeCredits,
        notice = policy.Notice,
        maxOutputTokens = app.Configuration.GetValue("MaxOutputTokens", 1024),
        voice = new
        {
            enabled = app.Configuration.GetValue("Transcribe:Enabled", true),
            creditsPerCall = app.Configuration.GetValue("Transcribe:CreditsPerCall", 3),
        },
        models = models.Select(m => new
        {
            m.ModelId,
            m.DisplayName,
            m.Provider,
            inputRatePer1K = m.InputRatePer1K,
            outputRatePer1K = m.OutputRatePer1K,
            maxContextChars = m.MaxContextChars,
            supportsVision = m.SupportsVision,
            m.Note,
        }),
        actions = PromptTemplates.Actions,
    });
});

app.MapGet("/api/credits", async (HttpContext http, AppDbContext db, CreditService credits, CancellationToken ct) =>
{
    var account = await credits.AuthenticateAsync(Bearer(http.Request), ct);
    var history = await credits.HistoryAsync(account.Id, 30, ct);

    return Results.Ok(new
    {
        balance = account.Balance,
        deviceId = account.DeviceId,
        transactions = history.Select(t => new
        {
            t.Delta, t.Reason, t.ModelId, t.InputTokens, t.OutputTokens,
            at = t.CreatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"),
        }),
    });
});

app.MapPost("/api/chat", async (HttpContext http, ChatRequest req, AppDbContext db, CreditService credits,
    ModelGateway gateway, IConfiguration config, CancellationToken ct) =>
{
    var account = await credits.AuthenticateAsync(Bearer(http.Request), ct);
    var policy = await credits.GetPolicyAsync(ct);
    if (!policy.ChatEnabled) throw new ApiException(503, "chat_disabled", "服务当前已暂停，请稍后再试");

    var model = await db.Models.FirstOrDefaultAsync(m => m.ModelId == req.Model && m.IsEnabled, ct)
        ?? throw new ApiException(404, "model_not_found", "模型不可用，请重新选择");

    var messages = BuildMessages(req, model);
    var maxTokens = Math.Clamp(req.MaxTokens ?? config.GetValue("MaxOutputTokens", 1024), 128, 4096);
    var estimatedInput = messages.Sum(TokenEstimator.EstimateMessage);
    var reserved = TokenEstimator.Charge(estimatedInput, model.InputRatePer1K)
                 + TokenEstimator.Charge(maxTokens, model.OutputRatePer1K);

    await credits.ReserveAsync(account.Id, reserved, ct);

    http.Response.ContentType = "text/event-stream; charset=utf-8";
    http.Response.Headers["Cache-Control"] = "no-cache";
    http.Response.Headers["X-Accel-Buffering"] = "no";

    string? error = null;
    var usage = new CompletionUsage(estimatedInput, 0, false);

    try
    {
        usage = await gateway.StreamAsync(model, messages, maxTokens,
            (kind, piece) => WriteEvent(http.Response,
                new { type = kind == DeltaKind.Reasoning ? "reasoning" : "delta", text = piece }, ct), ct);
    }
    catch (Exception ex)
    {
        error = ex switch
        {
            ApiException apiEx => apiEx.Message,
            OperationCanceledException => "请求已取消",
            _ => "连接模型服务时出错，请重试",
        };
        logger.LogWarning(ex, "模型调用失败：{Model}", req.Model);
    }

    // 失败与取消都按 0 用量结算，把预扣的积分整笔退回
    var actual = error is null ? usage : new CompletionUsage(0, 0, false);
    var balance = await credits.SettleAsync(account, model, reserved, actual.InputTokens, actual.OutputTokens,
        error is null ? "chat" : "refund", CancellationToken.None);

    try
    {
        await WriteEvent(http.Response, error is null
            ? new
            {
                type = "done",
                usage = new { inputTokens = usage.InputTokens, outputTokens = usage.OutputTokens, fromUpstream = usage.FromUpstream },
                balance,
            }
            : new { type = "error", error, balance }, CancellationToken.None);
    }
    catch (IOException)
    {
        // 客户端已断开，事件写不出去不影响结算结果
    }

    return Results.Empty;
});

// 语音输入：录音上传转写，按次扣分；识别失败不扣分，积分不足直接拒
app.MapPost("/api/transcribe", async (HttpContext http, IFormFile? file, CreditService credits,
    SpeechGateway speech, IConfiguration config, CancellationToken ct) =>
{
    if (!config.GetValue("Transcribe:Enabled", true))
    {
        throw new ApiException(503, "transcribe_disabled", "语音输入当前已关闭");
    }

    var account = await credits.AuthenticateAsync(Bearer(http.Request), ct);
    var cost = Math.Max(0, config.GetValue("Transcribe:CreditsPerCall", 3));
    if (account.Balance < cost)
    {
        throw new ApiException(402, "insufficient_credits", $"语音输入需要 {cost} 积分，当前余额 {account.Balance}");
    }

    if (file is null || file.Length == 0) throw new ApiException(400, "no_audio", "没有收到录音");

    // 一分钟中文录音压得动，超过这个体积基本是忘点停止
    const long MaxAudioBytes = 8 * 1024 * 1024;
    if (file.Length > MaxAudioBytes) throw new ApiException(413, "audio_too_large", "录音太长，请重新录制");

    string text;
    await using (var stream = file.OpenReadStream())
    {
        text = await speech.TranscribeAsync(stream, file.FileName, file.ContentType, ct);
    }

    var trimmed = (text ?? "").Trim();
    if (trimmed.Length == 0) throw new ApiException(502, "empty_transcription", "没有听清内容，请靠近麦克风再说一次");

    var balance = await credits.ChargeFixedAsync(account, cost, "voice",
        config["Transcribe:Model"] ?? "qwen3-asr-flash", ct);

    return Results.Ok(new { text = trimmed, cost, balance });
})
// 表单绑定会给端点加防伪要求，这里用 Bearer 令牌鉴权、不依赖 Cookie，明确关掉
.DisableAntiforgery();

var admin = app.MapGroup("/api/admin");
admin.AddEndpointFilter(async (context, next) =>
{
    var configured = app.Configuration["Admin:Key"];
    var http = context.HttpContext;
    if (!string.IsNullOrWhiteSpace(configured) && http.Request.Headers["X-Admin-Key"] != configured)
    {
        return Results.Json(new { code = "bad_admin_key", message = "管理密钥不正确" }, statusCode: 401);
    }

    return await next(context);
});

admin.MapGet("/policy", async (CreditService credits, CancellationToken ct) =>
{
    var policy = await credits.GetPolicyAsync(ct);
    return Results.Ok(new { policy.FreeCredits, policy.ChatEnabled, policy.Notice, policy.UpdatedAt });
});

admin.MapPut("/policy", async (PolicyRequest req, AppDbContext db, CancellationToken ct) =>
{
    var policy = await db.Policies.FirstAsync(ct);
    if (req.FreeCredits is { } freeCredits)
    {
        if (freeCredits < 0) throw new ApiException(400, "invalid_credits", "免费积分不能为负数");
        policy.FreeCredits = freeCredits;
    }

    if (req.ChatEnabled is { } chatEnabled) policy.ChatEnabled = chatEnabled;
    if (req.Notice is { } notice) policy.Notice = notice;
    policy.UpdatedAt = DateTime.UtcNow;

    await db.SaveChangesAsync(ct);
    return Results.Ok(new { policy.FreeCredits, policy.ChatEnabled, policy.Notice, policy.UpdatedAt });
});

admin.MapGet("/models", async (AppDbContext db, CancellationToken ct) =>
    Results.Ok(await db.Models.OrderBy(m => m.SortOrder).ToListAsync(ct)));

admin.MapPut("/models/{modelId}", async (string modelId, ModelRequest req, AppDbContext db, CancellationToken ct) =>
{
    var model = await db.Models.FirstOrDefaultAsync(m => m.ModelId == modelId, ct)
        ?? throw new ApiException(404, "model_not_found", "模型不存在");

    if (req.DisplayName is { } name) model.DisplayName = name;
    if (req.IsEnabled is { } enabled) model.IsEnabled = enabled;
    if (req.InputRatePer1K is { } inputRate) model.InputRatePer1K = Math.Max(0, inputRate);
    if (req.OutputRatePer1K is { } outputRate) model.OutputRatePer1K = Math.Max(0, outputRate);
    if (req.MaxContextChars is { } maxChars) model.MaxContextChars = Math.Clamp(maxChars, 1000, 200000);
    if (req.SortOrder is { } sort) model.SortOrder = sort;
    if (req.SupportsVision is { } vision) model.SupportsVision = vision;

    await db.SaveChangesAsync(ct);
    return Results.Ok(model);
});

admin.MapPost("/grant", async (GrantRequest req, AppDbContext db, CreditService credits, CancellationToken ct) =>
{
    var account = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == req.DeviceId, ct)
        ?? throw new ApiException(404, "account_not_found", "设备不存在");

    var delta = req.Delta ?? 0;
    if (delta == 0) throw new ApiException(400, "invalid_delta", "调整数量不能为 0");

    await credits.AdjustBalanceAsync(account.Id, delta, req.Reason ?? "admin_grant", ct);
    var balance = await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
    return Results.Ok(new { deviceId = account.DeviceId, delta, balance });
});

app.Run();

static string? Bearer(HttpRequest request) =>
    request.Headers.Authorization.ToString().Replace("Bearer ", "").Trim() is { Length: > 0 } v ? v : null;

static async Task WriteEvent(HttpResponse response, object payload, CancellationToken ct)
{
    var json = JsonSerializer.Serialize(payload);
    var bytes = Encoding.UTF8.GetBytes($"data: {json}\n\n");
    await response.Body.WriteAsync(bytes, ct);
    await response.Body.FlushAsync(ct);
}

static List<ChatMessage> BuildMessages(ChatRequest req, ModelSpec model)
{
    var system = string.IsNullOrWhiteSpace(req.System) ? PromptTemplates.DefaultSystem : req.System;
    var messages = new List<ChatMessage> { new("system", system) };

    foreach (var m in req.Messages ?? [])
    {
        var role = m.Role is "user" or "assistant" ? m.Role : "user";
        var images = role == "user" ? ValidateImages(m.Images, model) : [];
        var content = ClampLength(m.Content, role == "user" ? model.MaxContextChars : 8000);
        if (string.IsNullOrWhiteSpace(content) && images.Count == 0) continue;
        messages.Add(new ChatMessage(role, content, images));
    }

    if (messages.Count == 1) throw new ApiException(400, "empty_prompt", "消息内容为空");
    return messages;
}

static IReadOnlyList<string> ValidateImages(List<string>? images, ModelSpec model)
{
    const int MaxImages = 4;
    if (images is not { Count: > 0 }) return [];

    if (!model.SupportsVision)
    {
        throw new ApiException(400, "vision_unsupported", $"「{model.DisplayName}」不支持图片输入，请切换到支持视觉的模型");
    }

    if (images.Count > MaxImages)
    {
        throw new ApiException(400, "too_many_images", $"一次最多发送 {MaxImages} 张图片");
    }

    return images.Select(NormalizeImage).ToList();
}

static string NormalizeImage(string? raw)
{
    var value = (raw ?? "").Trim();
    if (value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
    {
        // 约 3 MB 原图，再大上游基本也会拒
        if (value.Length > 4_000_000) throw new ApiException(400, "image_too_large", "单张图片过大，请压缩后再发送");
        return value;
    }

    if (value.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
        || value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
    {
        return value;
    }

    throw new ApiException(400, "bad_image", "图片需要是 data:image 开头的 base64 或可访问的图片链接");
}

static string ClampLength(string text, int max) =>
    string.IsNullOrEmpty(text) ? "" : text.Length <= max ? text : text[..max];

public record RegisterRequest(string DeviceId, string? Label);
public record ChatMessageDto(string Role, string Content, List<string>? Images);
public record ChatRequest(string Model, List<ChatMessageDto>? Messages, string? System, int? MaxTokens);
public record PolicyRequest(int? FreeCredits, bool? ChatEnabled, string? Notice);
public record ModelRequest(string? DisplayName, bool? IsEnabled, int? InputRatePer1K, int? OutputRatePer1K,
    int? MaxContextChars, int? SortOrder, bool? SupportsVision);
public record GrantRequest(string DeviceId, int? Delta, string? Reason);
