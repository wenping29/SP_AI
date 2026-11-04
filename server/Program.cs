using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using SpServer.Data;
using SpServer.Domain;
using SpServer.Services;

var builder = WebApplication.CreateBuilder(args);

// 数据库密钥的加密密钥环放在仓库外，权限收紧；丢失后库里的密文需重新设置
var keysPath = builder.Configuration["Security:KeysPath"] ?? "keys";
if (!Path.IsPathRooted(keysPath)) keysPath = Path.Combine(builder.Environment.ContentRootPath, keysPath);
var keysDir = Directory.CreateDirectory(keysPath);
if (!OperatingSystem.IsWindows())
{
    File.SetUnixFileMode(keysDir.FullName,
        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
}

builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(keysDir)
    .SetApplicationName("SpServer");

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
builder.Services.AddScoped<AdminAuth>();
builder.Services.AddScoped<AdminAccounts>();
builder.Services.AddScoped<UserAuth>();
builder.Services.AddScoped<MemberAdmin>();
builder.Services.AddScoped<ConversationStore>();
builder.Services.AddScoped<ProviderKey>();
builder.Services.AddScoped<ModelGateway>();
builder.Services.AddScoped<SpeechGateway>();
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
    // EnsureCreated 只在建库时起作用，已有库不会补新表，这里幂等创建凭据表
    await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "ProviderCredentials" (
            "Provider" TEXT NOT NULL CONSTRAINT "PK_ProviderCredentials" PRIMARY KEY,
            "Cipher" TEXT NOT NULL,
            "MaskedTail" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL
        );
        """);
    await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "KeyEnvs" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_KeyEnvs" PRIMARY KEY AUTOINCREMENT,
            "Provider" TEXT NOT NULL,
            "EnvName" TEXT NOT NULL,
            "Cipher" TEXT NOT NULL,
            "MaskedTail" TEXT NOT NULL,
            "IsActive" INTEGER NOT NULL,
            "IsDeprecated" INTEGER NOT NULL,
            "Note" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_KeyEnvs_Provider_EnvName"
            ON "KeyEnvs" ("Provider", "EnvName" COLLATE NOCASE);
        """);
    // 每个提供商最多一条启用条目；EF 的 EnsureCreated 直接带上，老库靠这段补
    try
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE UNIQUE INDEX IF NOT EXISTS "IX_KeyEnvs_ActiveProvider"
                ON "KeyEnvs" ("Provider") WHERE "IsActive" = 1 AND "IsDeprecated" = 0;
            """);
    }
    catch (Exception ex)
    {
        // 历史上如果已有多条启用记录（手工改库等），索引建不起来，运行时按最新一条兜底
        logger.LogWarning(ex, "KeyEnvs 启用唯一索引创建失败，已有的重复启用条目需要人工清理");
    }

    // 管理员与角色表：老库同样靠这段补，SeedAsync 要在建表之后才能写内置角色
    await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "AdminRoles" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_AdminRoles" PRIMARY KEY AUTOINCREMENT,
            "Name" TEXT NOT NULL,
            "Description" TEXT NOT NULL,
            "Permissions" TEXT NOT NULL,
            "IsSystem" INTEGER NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_AdminRoles_Name" ON "AdminRoles" ("Name");

        CREATE TABLE IF NOT EXISTS "AdminUsers" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_AdminUsers" PRIMARY KEY AUTOINCREMENT,
            "Username" TEXT NOT NULL,
            "DisplayName" TEXT NOT NULL,
            "PasswordHash" TEXT NOT NULL,
            "RoleId" INTEGER NOT NULL,
            "IsDisabled" INTEGER NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "LastLoginAt" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_AdminUsers_Username" ON "AdminUsers" ("Username");

        CREATE TABLE IF NOT EXISTS "AdminSessions" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_AdminSessions" PRIMARY KEY AUTOINCREMENT,
            "UserId" INTEGER NOT NULL,
            "TokenHash" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "ExpiresAt" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_AdminSessions_TokenHash" ON "AdminSessions" ("TokenHash");
        CREATE INDEX IF NOT EXISTS "IX_AdminSessions_UserId" ON "AdminSessions" ("UserId");
        CREATE INDEX IF NOT EXISTS "IX_AdminSessions_ExpiresAt" ON "AdminSessions" ("ExpiresAt");
        """);

    // 普通用户账号与设备登录态：老库靠这段补表补列
    await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "Users" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_Users" PRIMARY KEY AUTOINCREMENT,
            "Email" TEXT NOT NULL,
            "PasswordHash" TEXT NOT NULL,
            "DisplayName" TEXT NOT NULL,
            "IsDisabled" INTEGER NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "LastLoginAt" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_Users_Email" ON "Users" ("Email" COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS "DeviceSessions" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_DeviceSessions" PRIMARY KEY AUTOINCREMENT,
            "AccountId" INTEGER NOT NULL,
            "AnonAccountId" INTEGER NOT NULL,
            "DeviceId" TEXT NOT NULL,
            "Token" TEXT NOT NULL,
            "Label" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "LastUsedAt" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_DeviceSessions_DeviceId" ON "DeviceSessions" ("DeviceId");
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_DeviceSessions_Token" ON "DeviceSessions" ("Token");
        CREATE INDEX IF NOT EXISTS "IX_DeviceSessions_AccountId" ON "DeviceSessions" ("AccountId");
        """);

    // 登录用户的聊天记录：客户端整段上传，仅按账号同步
    await db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "Conversations" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_Conversations" PRIMARY KEY AUTOINCREMENT,
            "UserId" INTEGER NOT NULL,
            "ClientId" TEXT NOT NULL,
            "Title" TEXT NOT NULL,
            "MessagesJson" TEXT NOT NULL,
            "MessageCount" INTEGER NOT NULL,
            "ClientUpdatedAt" INTEGER NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "IX_Conversations_UserId_ClientId"
            ON "Conversations" ("UserId", "ClientId");
        CREATE INDEX IF NOT EXISTS "IX_Conversations_UserId_UpdatedAt"
            ON "Conversations" ("UserId", "UpdatedAt");
        """);

    try
    {
        await db.Database.ExecuteSqlRawAsync(
            """ALTER TABLE "Accounts" ADD COLUMN "UserId" INTEGER NULL;""");
    }
    catch (Exception ex)
    {
        logger.LogDebug(ex, "Accounts.UserId 列已存在，跳过补列");
    }

    try
    {
        await db.Database.ExecuteSqlRawAsync(
            """CREATE INDEX IF NOT EXISTS "IX_Accounts_UserId" ON "Accounts" ("UserId");""");
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Accounts.UserId 索引创建失败");
    }

    // 老库的 Models 表没有废弃标记，EnsureCreated 不会补列，这里单独加一次
    try
    {
        await db.Database.ExecuteSqlRawAsync(
            """ALTER TABLE "Models" ADD COLUMN "IsDeprecated" INTEGER NOT NULL DEFAULT 0;""");
    }
    catch (Exception ex)
    {
        // 新库由 EnsureCreated 直接带上了该列，重复添加会报错，属正常情况
        logger.LogDebug(ex, "Models.IsDeprecated 列已存在，跳过补列");
    }

    // 模型分类同理补列；只有这次真的加上了列才回填，避免覆盖后台已改过的分类
    var categoryAdded = false;
    try
    {
        await db.Database.ExecuteSqlRawAsync(
            """ALTER TABLE "Models" ADD COLUMN "Category" TEXT NOT NULL DEFAULT '';""");
        categoryAdded = true;
    }
    catch (Exception ex)
    {
        logger.LogDebug(ex, "Models.Category 列已存在，跳过补列");
    }

    if (categoryAdded)
    {
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE "Models" SET "Category" = '高性价比'
                WHERE "ModelId" IN ('glm-4-flash','glm-5.3-flash','deepseek-chat','ernie-speed','deepseek-v3-sf','glm-4v-flash');
            UPDATE "Models" SET "Category" = '高级' WHERE "ModelId" = 'qwen-plus';
            UPDATE "Models" SET "Category" = '最智能' WHERE "ModelId" IN ('deepseek-reasoner','deepseek-v4-pro');
            """);
    }

    await db.SeedAsync();

    // 首次启动且没有任何管理员时创建初始账号；用户表非空时不再执行，重启不会覆盖已改密码
    var initialUsername = (app.Configuration["Admin:InitialUsername"] ?? "").Trim();
    var initialPassword = app.Configuration["Admin:InitialPassword"] ?? "";
    if (!await db.AdminUsers.AnyAsync())
    {
        if (initialUsername.Length == 0 || initialPassword.Length < 8)
        {
            logger.LogWarning("未配置 Admin:InitialUsername 或 Admin:InitialPassword，跳过初始管理员创建");
        }
        else
        {
            var role = await db.AdminRoles.FirstOrDefaultAsync(r => r.IsSystem)
                ?? await db.AdminRoles.OrderBy(r => r.Id).FirstOrDefaultAsync();
            if (role is null)
            {
                logger.LogWarning("内置角色缺失，跳过初始管理员创建");
            }
            else
            {
                var initialAdmin = new AdminUser
                {
                    Username = initialUsername,
                    DisplayName = "初始管理员",
                    RoleId = role.Id,
                    CreatedAt = DateTime.UtcNow,
                };
                initialAdmin.PasswordHash = scope.ServiceProvider
                    .GetRequiredService<AdminAuth>()
                    .HashPassword(initialAdmin, initialPassword);
                db.AdminUsers.Add(initialAdmin);
                await db.SaveChangesAsync();
                logger.LogInformation("已创建初始管理员账号 {Username}", initialUsername);
            }
        }
    }

    await scope.ServiceProvider.GetRequiredService<ProviderKey>().EnsureSeededAsync(CancellationToken.None);
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

// 普通用户账号：注册/登录时把本机匿名积分并入账号，退出后回落到本机匿名账号
app.MapPost("/api/auth/register", async (AuthRegisterRequest req, UserAuth auth, CancellationToken ct) =>
    Results.Ok(await auth.RegisterAsync(req.Email, req.Password, req.DisplayName, req.DeviceId, req.Label, ct)));

app.MapPost("/api/auth/login", async (AuthLoginRequest req, UserAuth auth, CancellationToken ct) =>
    Results.Ok(await auth.LoginAsync(req.Email, req.Password, req.DeviceId, req.Label, ct)));

app.MapPost("/api/auth/logout", async (HttpContext http, UserAuth auth, CancellationToken ct) =>
    Results.Ok(await auth.LogoutAsync(Bearer(http.Request), ct)));

app.MapGet("/api/auth/me", async (HttpContext http, UserAuth auth, CancellationToken ct) =>
    Results.Ok(await auth.MeAsync(Bearer(http.Request), ct)));

// 聊天记录同步：仅登录账号可用，匿名设备继续只存本地
app.MapGet("/api/conversations", async (HttpContext http, UserAuth auth, ConversationStore store,
    CancellationToken ct) =>
    Results.Ok(await store.ListAsync(await RequireMemberIdAsync(http, auth, ct), ct)));

app.MapGet("/api/conversations/{clientId}", async (string clientId, HttpContext http, UserAuth auth,
    ConversationStore store, CancellationToken ct) =>
    Results.Ok(await store.GetAsync(await RequireMemberIdAsync(http, auth, ct), clientId, ct)));

app.MapPut("/api/conversations/{clientId}", async (string clientId, ConversationUpsertRequest req,
    HttpContext http, UserAuth auth, ConversationStore store, CancellationToken ct) =>
    Results.Ok(await store.UpsertAsync(await RequireMemberIdAsync(http, auth, ct), clientId,
        req.Title, req.Messages, req.UpdatedAt, ct)));

app.MapDelete("/api/conversations/{clientId}", async (string clientId, HttpContext http, UserAuth auth,
    ConversationStore store, CancellationToken ct) =>
{
    var deleted = await store.DeleteAsync(await RequireMemberIdAsync(http, auth, ct), clientId, ct);
    return Results.Ok(new { clientId, deleted });
});

app.MapGet("/api/config", async (AppDbContext db, CreditService credits, ProviderKey keys,
    CancellationToken ct) =>
{
    var policy = await credits.GetPolicyAsync(ct);
    // 没有任何启用 KeyEnv 的提供商，其模型不下发，避免用户选中后才报错
    var usable = await keys.UsableProvidersAsync(ct);
    var models = await db.Models.Where(m => m.IsEnabled && !m.IsDeprecated && usable.Contains(m.Provider))
        .OrderBy(m => m.SortOrder).ToListAsync(ct);

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
            m.Category,
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
    ModelGateway gateway, ProviderKey keys, IConfiguration config, CancellationToken ct) =>
{
    var account = await credits.AuthenticateAsync(Bearer(http.Request), ct);
    var policy = await credits.GetPolicyAsync(ct);
    if (!policy.ChatEnabled) throw new ApiException(503, "chat_disabled", "服务当前已暂停，请稍后再试");

    var model = await db.Models.FirstOrDefaultAsync(m =>
            m.ModelId == req.Model && m.IsEnabled && !m.IsDeprecated, ct)
        ?? throw new ApiException(404, "model_not_found", "模型不可用，请重新选择");

    if (!await keys.IsUsableAsync(model.Provider, ct))
    {
        throw new ApiException(503, "provider_unavailable", "该模型所属服务暂未开放，请选择其他模型");
    }

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

// 登录入口必须放在鉴权组之外；Admin__Key 仍是应急总钥匙
app.MapPost("/api/admin/auth/login", async (AdminLoginRequest req, AdminAuth auth, CancellationToken ct) =>
{
    var (token, expiresAt, identity) = await auth.LoginAsync(req.Username ?? "", req.Password ?? "", ct);
    return Results.Ok(new { token, expiresAt, user = AdminAuth.ToView(identity) });
});

var admin = app.MapGroup("/api/admin");
admin.AddEndpointFilter(async (context, next) =>
{
    var http = context.HttpContext;
    var auth = http.RequestServices.GetRequiredService<AdminAuth>();
    var identity = await auth.ResolveAsync(http.Request, http.RequestAborted);

    if (identity is null)
    {
        return Results.Json(new { code = "unauthorized", message = "未登录或登录已过期，请重新登录" },
            statusCode: 401);
    }

    var requirement = http.GetEndpoint()?.Metadata.GetMetadata<AdminPermission>();
    if (requirement is { AnyOf.Length: > 0 } && !requirement.AnyOf.Any(identity.Has))
    {
        return Results.Json(new { code = "forbidden", message = "当前角色没有该模块的权限" }, statusCode: 403);
    }

    http.Items[AdminAuth.IdentityItem] = identity;
    return await next(context);
});

admin.MapGet("/auth/me", (HttpContext http) =>
    Results.Ok(AdminAuth.ToView((AdminIdentity)http.Items[AdminAuth.IdentityItem]!)));

admin.MapPost("/auth/logout", async (HttpContext http, AdminAuth auth, CancellationToken ct) =>
{
    await auth.LogoutAsync(http.Request, ct);
    return Results.Ok(new { ok = true });
});

admin.MapGet("/providers", async (ProviderKey keys, CancellationToken ct) =>
    Results.Ok(await keys.ListProvidersAsync(ct))).RequireAdmin("keyenvs.view");

// KeyEnv 条目：新增、修改、删除、废弃/恢复、切换启用
admin.MapGet("/keyenvs", async (string? provider, bool? includeDeprecated, ProviderKey keys,
    CancellationToken ct) =>
    Results.Ok(await keys.ListEntriesAsync(provider, includeDeprecated ?? false, ct)))
    .RequireAdmin("keyenvs.view");

admin.MapPost("/keyenvs", async (KeyEnvCreateRequest req, ProviderKey keys, CancellationToken ct) =>
{
    var entry = await keys.CreateAsync(req.Provider ?? "", req.EnvName, req.Key, req.Note,
        req.Activate ?? false, ct);
    return Results.Ok(entry);
}).RequireAdmin("keyenvs.manage");

admin.MapPut("/keyenvs/{id:int}", async (int id, KeyEnvUpdateRequest req, ProviderKey keys,
    CancellationToken ct) =>
    Results.Ok(await keys.UpdateAsync(id, req.EnvName, req.Key, req.ClearKey ?? false, req.Note, ct)))
    .RequireAdmin("keyenvs.manage");

admin.MapDelete("/keyenvs/{id:int}", async (int id, ProviderKey keys, CancellationToken ct) =>
{
    await keys.DeleteAsync(id, ct);
    return Results.Ok(new { id, deleted = true });
}).RequireAdmin("keyenvs.manage");

admin.MapPost("/keyenvs/{id:int}/activate", async (int id, ProviderKey keys, CancellationToken ct) =>
    Results.Ok(await keys.ActivateAsync(id, ct))).RequireAdmin("keyenvs.manage");

admin.MapPost("/keyenvs/{id:int}/deprecate", async (int id, DeprecateRequest req, ProviderKey keys,
    CancellationToken ct) =>
{
    if (req.Deprecated is null) throw new ApiException(400, "invalid_deprecate", "缺少废弃状态");
    return Results.Ok(await keys.SetDeprecatedAsync(id, req.Deprecated.Value, ct));
}).RequireAdmin("keyenvs.manage");

// 兼容旧的单密钥入口：写到当前启用条目，响应里只回尾号
admin.MapPut("/providers/{provider}/key", async (string provider, ProviderKeyRequest req, ProviderKey keys,
    CancellationToken ct) => Results.Ok(await keys.SaveAsync(provider, req.Key, ct)))
    .RequireAdmin("keyenvs.manage");

admin.MapGet("/policy", async (CreditService credits, CancellationToken ct) =>
{
    var policy = await credits.GetPolicyAsync(ct);
    return Results.Ok(new
    {
        policy.FreeCredits, policy.ChatEnabled, policy.Notice, UpdatedAt = AsUtc(policy.UpdatedAt),
    });
}).RequireAdmin("policy.view");

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
    return Results.Ok(new
    {
        policy.FreeCredits, policy.ChatEnabled, policy.Notice, UpdatedAt = AsUtc(policy.UpdatedAt),
    });
}).RequireAdmin("policy.manage");

admin.MapGet("/models", async (AppDbContext db, CancellationToken ct) =>
    Results.Ok(await db.Models
        .OrderBy(m => m.IsDeprecated)
        .ThenBy(m => m.SortOrder)
        .ThenBy(m => m.Id)
        .ToListAsync(ct))).RequireAdmin("models.view");

// 新增模型时给下拉框用，避免依赖 KeyEnv 查看权限
admin.MapGet("/model-providers", (ProviderKey keys) =>
    Results.Ok(keys.Providers().Select(p => new { p.Provider, p.BaseUrl })))
    .RequireAdmin("models.view");

admin.MapPost("/models", async (ModelCreateRequest req, AppDbContext db, ProviderKey keys,
    CancellationToken ct) =>
{
    var modelId = NormalizeModelId(req.ModelId);
    if (await db.Models.AnyAsync(m => m.ModelId.ToLower() == modelId.ToLower(), ct))
    {
        throw new ApiException(409, "model_id_exists", $"模型 ID {modelId} 已存在");
    }

    var model = new ModelSpec
    {
        ModelId = modelId,
        DisplayName = RequireText(req.DisplayName, "显示名称", 60),
        Provider = keys.CanonicalProvider(req.Provider ?? ""),
        UpstreamModel = RequireText(req.UpstreamModel, "上游模型名", 128),
        InputRatePer1K = Math.Clamp(req.InputRatePer1K ?? 0, 0, 100000),
        OutputRatePer1K = Math.Clamp(req.OutputRatePer1K ?? 0, 0, 100000),
        MaxContextChars = Math.Clamp(req.MaxContextChars ?? 12000, 1000, 200000),
        SupportsVision = req.SupportsVision ?? false,
        IsEnabled = req.IsEnabled ?? true,
        SortOrder = req.SortOrder ?? (await db.Models.MaxAsync(m => (int?)m.SortOrder, ct) ?? 0) + 1,
        Category = ClampText(req.Category, 20),
        Note = ClampText(req.Note, 200),
    };

    db.Models.Add(model);
    await db.SaveChangesAsync(ct);
    return Results.Ok(model);
}).RequireAdmin("models.manage");

admin.MapPut("/models/{modelId}", async (string modelId, ModelRequest req, AppDbContext db, ProviderKey keys,
    CancellationToken ct) =>
{
    var model = await db.Models.FirstOrDefaultAsync(m => m.ModelId == modelId, ct)
        ?? throw new ApiException(404, "model_not_found", "模型不存在");

    if (req.DisplayName is not null) model.DisplayName = RequireText(req.DisplayName, "显示名称", 60);
    if (req.Provider is not null) model.Provider = keys.CanonicalProvider(req.Provider);
    if (req.UpstreamModel is not null) model.UpstreamModel = RequireText(req.UpstreamModel, "上游模型名", 128);

    if (req.IsEnabled is { } enabled)
    {
        if (enabled && model.IsDeprecated)
        {
            throw new ApiException(409, "deprecated_model", "模型已废弃，请先恢复再启用");
        }

        model.IsEnabled = enabled;
    }

    if (req.InputRatePer1K is { } inputRate) model.InputRatePer1K = Math.Clamp(inputRate, 0, 100000);
    if (req.OutputRatePer1K is { } outputRate) model.OutputRatePer1K = Math.Clamp(outputRate, 0, 100000);
    if (req.MaxContextChars is { } maxChars) model.MaxContextChars = Math.Clamp(maxChars, 1000, 200000);
    if (req.SortOrder is { } sort) model.SortOrder = Math.Clamp(sort, 0, 9999);
    if (req.SupportsVision is { } vision) model.SupportsVision = vision;
    if (req.Category is not null) model.Category = ClampText(req.Category, 20);
    if (req.Note is not null) model.Note = ClampText(req.Note, 200);

    await db.SaveChangesAsync(ct);
    return Results.Ok(model);
}).RequireAdmin("models.manage");

admin.MapPost("/models/{modelId}/deprecate", async (string modelId, DeprecateRequest req, AppDbContext db,
    CancellationToken ct) =>
{
    if (req.Deprecated is null) throw new ApiException(400, "invalid_deprecated", "缺少废弃状态");

    var model = await db.Models.FirstOrDefaultAsync(m => m.ModelId == modelId, ct)
        ?? throw new ApiException(404, "model_not_found", "模型不存在");

    model.IsDeprecated = req.Deprecated.Value;
    // 废弃即下线；恢复后保持停用，由管理员确认后再启用
    if (model.IsDeprecated) model.IsEnabled = false;

    await db.SaveChangesAsync(ct);
    return Results.Ok(model);
}).RequireAdmin("models.manage");

admin.MapDelete("/models/{modelId}", async (string modelId, AppDbContext db, CancellationToken ct) =>
{
    var model = await db.Models.FirstOrDefaultAsync(m => m.ModelId == modelId, ct)
        ?? throw new ApiException(404, "model_not_found", "模型不存在");

    // 调用记录按模型 ID 保存，直接删会丢失名称映射；有历史的模型只能废弃
    if (await db.Transactions.AnyAsync(t => t.ModelId == model.ModelId, ct))
    {
        throw new ApiException(409, "model_in_use", "该模型已有调用记录，请改为废弃以保留历史");
    }

    db.Models.Remove(model);
    await db.SaveChangesAsync(ct);
    return Results.Ok(new { modelId, deleted = true });
}).RequireAdmin("models.manage");

admin.MapPost("/grant", async (GrantRequest req, AppDbContext db, CreditService credits, CancellationToken ct) =>
{
    var account = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == req.DeviceId, ct)
        ?? throw new ApiException(404, "account_not_found", "设备不存在");

    var delta = req.Delta ?? 0;
    if (delta == 0) throw new ApiException(400, "invalid_delta", "调整数量不能为 0");
    if (delta < 0 && account.Balance + delta < 0)
    {
        throw new ApiException(400, "balance_below_zero",
            $"扣减后余额会变成 {account.Balance + delta}，请减少扣减数量");
    }

    await credits.AdjustBalanceAsync(account.Id, delta, req.Reason ?? "admin_grant", ct);
    var balance = await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
    return Results.Ok(new { deviceId = account.DeviceId, delta, balance });
}).RequireAdmin("devices.manage");

// 积分管理页汇总；手工增减/设值不算用户消费
admin.MapGet("/credits/summary", async (AppDbContext db, CancellationToken ct) =>
{
    var accounts = await db.Accounts.CountAsync(ct);
    var totalBalance = await db.Accounts.SumAsync(a => (int?)a.Balance, ct) ?? 0;
    var blocked = await db.Accounts.CountAsync(a => a.IsBlocked, ct);
    var spent = -(await db.Transactions
        .Where(t => t.Delta < 0 && t.Reason != "admin_grant" && t.Reason != "admin_set")
        .SumAsync(t => (int?)t.Delta, ct) ?? 0);
    var calls = await db.Transactions
        .CountAsync(t => t.Delta < 0 && t.Reason != "admin_grant" && t.Reason != "admin_set", ct);

    return Results.Ok(new { accounts, totalBalance, blocked, spent, calls });
}).RequireAdmin("devices.view");

// 直接改分：delta 为增减，balance 为设为指定余额，二者只传一个
admin.MapPost("/credits/adjust", async (CreditAdjustRequest req, AppDbContext db, CreditService credits,
    CancellationToken ct) =>
{
    var deviceId = (req.DeviceId ?? "").Trim();
    if (deviceId.Length == 0) throw new ApiException(400, "invalid_device", "缺少设备 ID");
    if ((req.Delta is null) == (req.Balance is null))
    {
        throw new ApiException(400, "invalid_adjust", "请提供 delta 或 balance 其中一个");
    }

    var account = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == deviceId, ct)
        ?? throw new ApiException(404, "account_not_found", "用户不存在");

    int delta;
    string defaultReason;
    if (req.Balance is { } target)
    {
        if (target < 0) throw new ApiException(400, "invalid_balance", "目标余额不能为负数");
        target = Math.Min(target, 100_000_000);
        delta = target - account.Balance;
        defaultReason = "admin_set";
    }
    else
    {
        delta = req.Delta!.Value;
        defaultReason = "admin_grant";
    }

    if (delta != 0)
    {
        if (delta < 0 && account.Balance + delta < 0)
        {
            throw new ApiException(400, "balance_below_zero",
                $"扣减后余额会变成 {account.Balance + delta}，请减少扣减数量");
        }

        var reason = string.IsNullOrWhiteSpace(req.Reason) ? defaultReason : ClampText(req.Reason, 40);
        await credits.AdjustBalanceAsync(account.Id, delta, reason, ct);
    }

    var balance = await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
    return Results.Ok(new { deviceId = account.DeviceId, label = account.Label, delta, balance });
}).RequireAdmin("devices.manage");

admin.MapGet("/stats", async (AppDbContext db, CancellationToken ct) =>
{
    // 用近 24 小时而不是自然日，避免服务器 UTC 与国内时区不一致导致“今日”口径漂移
    var since = DateTime.UtcNow.AddHours(-24);
    var accounts = await db.Accounts.CountAsync(ct);
    var totalBalance = await db.Accounts.SumAsync(a => (int?)a.Balance, ct) ?? 0;
    var blocked = await db.Accounts.CountAsync(a => a.IsBlocked, ct);
    var modelCount = await db.Models.CountAsync(m => !m.IsDeprecated, ct);
    var enabledModels = await db.Models.CountAsync(m => m.IsEnabled && !m.IsDeprecated, ct);
    // 只统计真实消耗；后台手工增减/设值不算用户消费
    var calls24h = await db.Transactions
        .CountAsync(t => t.CreatedAt >= since && t.Delta < 0 && t.Reason != "admin_grant"
            && t.Reason != "admin_set", ct);
    var consumed24h = -(await db.Transactions
        .Where(t => t.CreatedAt >= since && t.Delta < 0 && t.Reason != "admin_grant"
            && t.Reason != "admin_set")
        .SumAsync(t => (int?)t.Delta, ct) ?? 0);
    var active24h = await db.Accounts.CountAsync(a => a.LastUsedAt >= since, ct);

    var recentRows = await (from t in db.Transactions.AsNoTracking()
                            join a in db.Accounts.AsNoTracking() on t.AccountId equals a.Id
                            orderby t.Id descending
                            select new
                            {
                                t.Id, a.DeviceId, a.Label, t.Delta, t.Reason, t.ModelId,
                                t.InputTokens, t.OutputTokens, t.CreatedAt,
                            })
                           .Take(10)
                           .ToListAsync(ct);

    var recent = recentRows.Select(t => new
    {
        t.Id, t.DeviceId, t.Label, t.Delta, t.Reason, t.ModelId,
        t.InputTokens, t.OutputTokens, CreatedAt = AsUtc(t.CreatedAt),
    });

    return Results.Ok(new
    {
        accounts, totalBalance, blocked, modelCount, enabledModels,
        calls24h, consumed24h, active24h, recent,
    });
}).RequireAdmin("dashboard.view");

admin.MapGet("/devices", async (string? q, int? page, int? pageSize, AppDbContext db,
    CancellationToken ct) =>
{
    var query = db.Accounts.AsNoTracking();
    var keyword = (q ?? "").Trim();
    if (keyword.Length > 0)
    {
        query = query.Where(a => a.DeviceId.Contains(keyword) || a.Label.Contains(keyword));
    }

    var total = await query.CountAsync(ct);
    var size = Math.Clamp(pageSize ?? 20, 1, 100);
    var current = Math.Max(page ?? 1, 1);

    var accounts = await query
        .OrderByDescending(a => a.LastUsedAt)
        .ThenByDescending(a => a.Id)
        .Skip((current - 1) * size)
        .Take(size)
        .Select(a => new
        {
            a.Id, a.DeviceId, a.Label, a.Balance, a.IsBlocked, a.CreatedAt, a.LastUsedAt,
        })
        .ToListAsync(ct);

    var ids = accounts.Select(a => a.Id).ToList();
    var usage = await db.Transactions.AsNoTracking()
        .Where(t => ids.Contains(t.AccountId) && t.Delta < 0 && t.Reason != "admin_grant"
            && t.Reason != "admin_set")
        .GroupBy(t => t.AccountId)
        .Select(g => new { AccountId = g.Key, Spent = -g.Sum(t => t.Delta), Calls = g.Count() })
        .ToDictionaryAsync(u => u.AccountId, ct);

    return Results.Ok(new
    {
        total,
        page = current,
        pageSize = size,
        items = accounts.Select(a =>
        {
            var spent = usage.TryGetValue(a.Id, out var u) ? u.Spent : 0;
            var calls = usage.TryGetValue(a.Id, out var u2) ? u2.Calls : 0;
            return new
            {
                a.DeviceId, a.Label, a.Balance, a.IsBlocked,
                CreatedAt = AsUtc(a.CreatedAt), LastUsedAt = AsUtc(a.LastUsedAt), spent, calls,
            };
        }),
    });
}).RequireAdmin("devices.view");

admin.MapGet("/devices/{deviceId}/transactions", async (string deviceId, int? take, AppDbContext db,
    CancellationToken ct) =>
{
    var account = await db.Accounts.AsNoTracking()
        .FirstOrDefaultAsync(a => a.DeviceId == deviceId, ct)
        ?? throw new ApiException(404, "account_not_found", "设备不存在");

    var rows = await db.Transactions.AsNoTracking()
        .Where(t => t.AccountId == account.Id)
        .OrderByDescending(t => t.Id)
        .Take(Math.Clamp(take ?? 50, 1, 200))
        .ToListAsync(ct);

    var items = rows.Select(t => new
    {
        t.Id, t.Delta, t.Reason, t.ModelId, t.InputTokens, t.OutputTokens, CreatedAt = AsUtc(t.CreatedAt),
    });

    return Results.Ok(new
    {
        deviceId = account.DeviceId,
        label = account.Label,
        balance = account.Balance,
        isBlocked = account.IsBlocked,
        items,
    });
}).RequireAdmin("devices.view");

admin.MapPost("/devices/{deviceId}/block", async (string deviceId, BlockRequest req, AppDbContext db,
    CancellationToken ct) =>
{
    if (req.Blocked is null) throw new ApiException(400, "invalid_block", "缺少封禁状态");

    var account = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == deviceId, ct)
        ?? throw new ApiException(404, "account_not_found", "设备不存在");

    account.IsBlocked = req.Blocked.Value;
    await db.SaveChangesAsync(ct);
    return Results.Ok(new { deviceId = account.DeviceId, isBlocked = account.IsBlocked });
}).RequireAdmin("devices.manage");

// 管理员账号：新增、修改、删除；自己不能删自己、不能停用自己
admin.MapGet("/users", async (AdminAccounts accounts, CancellationToken ct) =>
    Results.Ok(await accounts.ListUsersAsync(ct))).RequireAdmin("admins.view");

admin.MapPost("/users", async (AdminUserCreateRequest req, AdminAccounts accounts, CancellationToken ct) =>
    Results.Ok(await accounts.CreateUserAsync(req.Username, req.DisplayName, req.RoleId, req.Password, ct)))
    .RequireAdmin("admins.manage");

admin.MapPut("/users/{id:int}", async (int id, AdminUserUpdateRequest req, HttpContext http,
    AdminAccounts accounts, CancellationToken ct) =>
{
    var current = (AdminIdentity)http.Items[AdminAuth.IdentityItem]!;
    return Results.Ok(await accounts.UpdateUserAsync(id, req.DisplayName, req.RoleId, req.Password,
        req.IsDisabled, current, ct));
}).RequireAdmin("admins.manage");

admin.MapDelete("/users/{id:int}", async (int id, HttpContext http, AdminAccounts accounts,
    CancellationToken ct) =>
{
    var current = (AdminIdentity)http.Items[AdminAuth.IdentityItem]!;
    await accounts.DeleteUserAsync(id, current, ct);
    return Results.Ok(new { id, deleted = true });
}).RequireAdmin("admins.manage");

// 普通用户（插件端注册）：与管理员分表，支持新增、编辑、重置密码、封禁与删除
admin.MapGet("/members", async (string? q, int? page, int? pageSize, MemberAdmin members,
    CancellationToken ct) =>
    Results.Ok(await members.ListAsync(q, page ?? 1, pageSize ?? 20, ct))).RequireAdmin("users.view");

admin.MapPost("/members", async (MemberCreateRequest req, MemberAdmin members, CancellationToken ct) =>
    Results.Ok(await members.CreateAsync(req.Email, req.DisplayName, req.Password, ct)))
    .RequireAdmin("users.manage");

admin.MapPut("/members/{id:int}", async (int id, MemberUpdateRequest req, MemberAdmin members,
    CancellationToken ct) =>
    Results.Ok(await members.UpdateAsync(id, req.Email, req.DisplayName, req.Password, ct)))
    .RequireAdmin("users.manage");

admin.MapPost("/members/{id:int}/block", async (int id, MemberBlockRequest req, MemberAdmin members,
    CancellationToken ct) =>
    Results.Ok(await members.BlockAsync(id, req.Blocked ?? false, ct))).RequireAdmin("users.manage");

admin.MapDelete("/members/{id:int}", async (int id, MemberAdmin members, CancellationToken ct) =>
{
    await members.DeleteAsync(id, ct);
    return Results.Ok(new { id, deleted = true });
}).RequireAdmin("users.manage");

// 角色：列表同时给管理员页选角色用，所以 admins.manage 也能读
admin.MapGet("/roles", async (AdminAccounts accounts, CancellationToken ct) =>
    Results.Ok(await accounts.ListRolesAsync(ct))).RequireAdmin("roles.view", "admins.manage");

admin.MapPost("/roles", async (AdminRoleRequest req, AdminAccounts accounts, CancellationToken ct) =>
    Results.Ok(await accounts.CreateRoleAsync(req.Name, req.Description, req.Permissions, ct)))
    .RequireAdmin("roles.manage");

admin.MapPut("/roles/{id:int}", async (int id, AdminRoleRequest req, AdminAccounts accounts,
    CancellationToken ct) =>
    Results.Ok(await accounts.UpdateRoleAsync(id, req.Name, req.Description, req.Permissions, ct)))
    .RequireAdmin("roles.manage");

admin.MapDelete("/roles/{id:int}", async (int id, AdminAccounts accounts, CancellationToken ct) =>
{
    await accounts.DeleteRoleAsync(id, ct);
    return Results.Ok(new { id, deleted = true });
}).RequireAdmin("roles.manage");

var adminIndex = Path.Combine(app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot"),
    "admin", "index.html");
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallback(async (HttpContext context) =>
{
    if (!context.Request.Path.StartsWithSegments("/admin") || !File.Exists(adminIndex))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(adminIndex);
});

app.Run();

// SQLite 读出来的 DateTime 没有 Kind，统一按 UTC 输出，避免前端当成本地时间
static DateTime AsUtc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

static string NormalizeModelId(string? value)
{
    var id = (value ?? "").Trim();
    if (!Regex.IsMatch(id, @"^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$"))
    {
        throw new ApiException(400, "invalid_model_id",
            "模型 ID 需为 2-64 位字母、数字、点、下划线、冒号或短横线");
    }

    return id;
}

static string RequireText(string? value, string field, int max)
{
    var text = (value ?? "").Trim();
    if (text.Length == 0) throw new ApiException(400, "invalid_model", $"{field}不能为空");
    if (text.Length > max) throw new ApiException(400, "invalid_model", $"{field}最多 {max} 个字符");
    return text;
}

static string ClampText(string? value, int max)
{
    var text = (value ?? "").Trim();
    return text.Length <= max ? text : text[..max];
}

static string? Bearer(HttpRequest request) =>
    request.Headers.Authorization.ToString().Replace("Bearer ", "").Trim() is { Length: > 0 } v ? v : null;

static async Task<int> RequireMemberIdAsync(HttpContext http, UserAuth auth, CancellationToken ct)
{
    var account = await auth.ResolveAccountAsync(Bearer(http.Request), ct)
        ?? throw new ApiException(401, "bad_token", "登录已失效，请重新登录");
    return account.UserId ?? throw new ApiException(403, "login_required", "登录后才能同步聊天记录");
}

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
public record AuthRegisterRequest(string? Email, string? Password, string? DisplayName, string? DeviceId,
    string? Label);
public record AuthLoginRequest(string? Email, string? Password, string? DeviceId, string? Label);
public record ChatMessageDto(string Role, string Content, List<string>? Images);
public record ChatRequest(string Model, List<ChatMessageDto>? Messages, string? System, int? MaxTokens);
public record PolicyRequest(int? FreeCredits, bool? ChatEnabled, string? Notice);
public record ModelRequest(string? DisplayName, bool? IsEnabled, int? InputRatePer1K, int? OutputRatePer1K,
    int? MaxContextChars, int? SortOrder, bool? SupportsVision, string? Note, string? Provider,
    string? UpstreamModel, string? Category);
public record ModelCreateRequest(string? ModelId, string? DisplayName, string? Provider, string? UpstreamModel,
    int? InputRatePer1K, int? OutputRatePer1K, int? MaxContextChars, bool? SupportsVision, bool? IsEnabled,
    int? SortOrder, string? Note, string? Category);
public record GrantRequest(string DeviceId, int? Delta, string? Reason);
public record CreditAdjustRequest(string? DeviceId, int? Delta, int? Balance, string? Reason);
public record BlockRequest(bool? Blocked);
public record ProviderKeyRequest(string? Key);
public record KeyEnvCreateRequest(string? Provider, string? EnvName, string? Key, string? Note, bool? Activate);
public record KeyEnvUpdateRequest(string? EnvName, string? Key, bool? ClearKey, string? Note);
public record DeprecateRequest(bool? Deprecated);
public record AdminLoginRequest(string? Username, string? Password);
public record AdminUserCreateRequest(string? Username, string? DisplayName, int? RoleId, string? Password);
public record AdminUserUpdateRequest(string? DisplayName, int? RoleId, string? Password, bool? IsDisabled);
public record AdminRoleRequest(string? Name, string? Description, string[]? Permissions);
public record MemberCreateRequest(string? Email, string? DisplayName, string? Password);
public record MemberUpdateRequest(string? Email, string? DisplayName, string? Password);
public record MemberBlockRequest(bool? Blocked);
public record ConversationUpsertRequest(string? Title, JsonElement Messages, long? UpdatedAt);
