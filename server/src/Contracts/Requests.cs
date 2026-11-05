using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace SpServer.Contracts;

// 所有 HTTP 请求体契约集中在这里，控制器按业务域引用
public record RegisterRequest(string DeviceId, string? Label);
public record AuthRegisterRequest(string? Email, string? Password, string? DisplayName, string? DeviceId,
    string? Label, string? Code);
public record EmailCodeRequest(string? Email);
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
public record ServerSettingsRequest(
    bool? SmtpEnabled,
    string? SmtpHost,
    int? SmtpPort,
    bool? SmtpImplicitTls,
    string? SmtpUser,
    string? SmtpPassword,
    bool? ClearSmtpPassword,
    string? SmtpFrom,
    string? SmtpFromName,
    int? CodeMinutes,
    bool? ExposeDevCode,
    string[]? AllowedOrigins);
public record TestEmailRequest(string? To);

// 语音转写：录音文件以 multipart/form-data 的 file 字段上传，Swagger 需要包一层表单模型才能生成文档
public class TranscribeRequest
{
    [FromForm(Name = "file")]
    public IFormFile? File { get; set; }
}
