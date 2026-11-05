using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 控制器共用的无状态辅助方法（原 Program.cs 末尾的本地函数）
public static class ApiHelpers
{
    // SQLite 读出来的 DateTime 没有 Kind，统一按 UTC 输出，避免前端当成本地时间
    public static DateTime AsUtc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public static string? Bearer(HttpRequest request) =>
        request.Headers.Authorization.ToString().Replace("Bearer ", "").Trim() is { Length: > 0 } v ? v : null;

    public static AdminIdentity CurrentAdmin(HttpContext http) =>
        (AdminIdentity)http.Items[AdminAuth.IdentityItem]!;

    public static async Task<int> RequireMemberIdAsync(HttpContext http, UserAuth auth, CancellationToken ct)
    {
        var account = await auth.ResolveAccountAsync(Bearer(http.Request), ct)
            ?? throw new ApiException(401, "bad_token", "登录已失效，请重新登录");
        return account.UserId ?? throw new ApiException(403, "login_required", "登录后才能同步聊天记录");
    }

    public static async Task WriteEvent(HttpResponse response, object payload, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(payload);
        var bytes = Encoding.UTF8.GetBytes($"data: {json}\n\n");
        await response.Body.WriteAsync(bytes, ct);
        await response.Body.FlushAsync(ct);
    }

    public static List<ChatMessage> BuildMessages(ChatRequest req, ModelSpec model)
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

    private static IReadOnlyList<string> ValidateImages(List<string>? images, ModelSpec model)
    {
        const int MaxImages = 4;
        if (images is not { Count: > 0 }) return [];

        if (!model.SupportsVision)
        {
            throw new ApiException(400, "vision_unsupported",
                $"「{model.DisplayName}」不支持图片输入，请切换到支持视觉的模型");
        }

        if (images.Count > MaxImages)
        {
            throw new ApiException(400, "too_many_images", $"一次最多发送 {MaxImages} 张图片");
        }

        return images.Select(NormalizeImage).ToList();
    }

    private static string NormalizeImage(string? raw)
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

    private static string ClampLength(string text, int max) =>
        string.IsNullOrEmpty(text) ? "" : text.Length <= max ? text : text[..max];

    public static string NormalizeModelId(string? value)
    {
        var id = (value ?? "").Trim();
        if (!Regex.IsMatch(id, @"^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$"))
        {
            throw new ApiException(400, "invalid_model_id",
                "模型 ID 需为 2-64 位字母、数字、点、下划线、冒号或短横线");
        }

        return id;
    }

    public static string RequireText(string? value, string field, int max)
    {
        var text = (value ?? "").Trim();
        if (text.Length == 0) throw new ApiException(400, "invalid_model", $"{field}不能为空");
        if (text.Length > max) throw new ApiException(400, "invalid_model", $"{field}最多 {max} 个字符");
        return text;
    }

    public static string ClampText(string? value, int max)
    {
        var text = (value ?? "").Trim();
        return text.Length <= max ? text : text[..max];
    }
}
