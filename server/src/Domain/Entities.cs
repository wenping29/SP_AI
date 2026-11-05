namespace SpServer.Domain;

public class Account
{
    public int Id { get; set; }
    public string DeviceId { get; set; } = "";
    public string Token { get; set; } = "";
    public string Label { get; set; } = "";
    public int Balance { get; set; }
    public bool IsBlocked { get; set; }
    // 登录用户的计费账号指向 User；匿名设备账号为 null
    public int? UserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastUsedAt { get; set; }
}

// 普通用户：邮箱 + 密码；积分与流水归账号，设备只是登录入口
public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool IsDisabled { get; set; }
    // 老账号迁移时默认视为已验证；新注册必须通过邮箱验证码
    public bool EmailVerified { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime LastLoginAt { get; set; }
}

// 邮箱注册验证码：只存哈希，限时有效，校验通过后标记已消费
public class EmailCode
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string CodeHash { get; set; } = "";
    public string Salt { get; set; } = "";
    public string RequestIp { get; set; } = "";
    public int Attempts { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConsumedAt { get; set; }
}

// 设备登录态：令牌指向账号；退出登录时回落到该设备的匿名账号
public class DeviceSession
{
    public int Id { get; set; }
    public int AccountId { get; set; }
    public int AnonAccountId { get; set; }
    public string DeviceId { get; set; } = "";
    public string Token { get; set; } = "";
    public string Label { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime LastUsedAt { get; set; }
}

// 登录用户的聊天记录：客户端整段上传快照，按账号同步到其他设备
public class Conversation
{
    public int Id { get; set; }
    public int UserId { get; set; }
    // 客户端生成的会话 ID，同一用户内唯一
    public string ClientId { get; set; } = "";
    public string Title { get; set; } = "";
    public string MessagesJson { get; set; } = "[]";
    public int MessageCount { get; set; }
    // 客户端本地 updatedAt（毫秒），用于两端冲突比较
    public long ClientUpdatedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class CreditTransaction
{
    public int Id { get; set; }
    public int AccountId { get; set; }
    public int Delta { get; set; }
    public string Reason { get; set; } = "";
    public string ModelId { get; set; } = "";
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class ModelSpec
{
    public int Id { get; set; }
    public string ModelId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Provider { get; set; } = "";
    public string UpstreamModel { get; set; } = "";
    public int InputRatePer1K { get; set; }
    public int OutputRatePer1K { get; set; }
    public int MaxContextChars { get; set; } = 12000;
    public bool SupportsVision { get; set; }
    public bool IsEnabled { get; set; } = true;
    // 分类用于插件里的模型分组，例如 高性价比 / 高级 / 最智能
    public string Category { get; set; } = "";
    // 废弃后不再下发给插件，但保留记录与调用历史，可恢复
    public bool IsDeprecated { get; set; }
    public int SortOrder { get; set; }
    public string Note { get; set; } = "";
}

// 上游密钥的库里副本：只存密文与尾号，明文仅在内存中出现
public class ProviderCredential
{
    public string Provider { get; set; } = "";
    public string Cipher { get; set; } = "";
    public string MaskedTail { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}

// KeyEnv 条目：一个提供商可以有多条，只有一条当前启用；废弃是软删除，密钥仍保留
public class KeyEnvEntry
{
    public int Id { get; set; }
    public string Provider { get; set; } = "";
    public string EnvName { get; set; } = "";
    public string Cipher { get; set; } = "";
    public string MaskedTail { get; set; } = "";
    public bool IsActive { get; set; }
    public bool IsDeprecated { get; set; }
    public string Note { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

// 后台管理员：角色决定能访问哪些模块，密码只存哈希
public class AdminUser
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public int RoleId { get; set; }
    public bool IsDisabled { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastLoginAt { get; set; }
}

public class AdminRole
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    // JSON 字符串数组，权限键形如 devices.manage；"*" 表示全部
    public string Permissions { get; set; } = "[]";
    public bool IsSystem { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

// 登录会话：只存令牌哈希，过期后自动失效
public class AdminSession
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
}

public class CreditPolicy
{
    public int Id { get; set; } = 1;
    public int FreeCredits { get; set; } = 1000;
    public bool ChatEnabled { get; set; } = true;
    public string Notice { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}

// 服务器运行配置：邮件服务与浏览器跨域来源，后台改完即时生效，不需要改文件重启
public class ServerSetting
{
    public int Id { get; set; } = 1;
    public bool SmtpEnabled { get; set; }
    public string SmtpHost { get; set; } = "";
    public int SmtpPort { get; set; } = 465;
    public bool SmtpImplicitTls { get; set; } = true;
    public string SmtpUser { get; set; } = "";
    public string SmtpPasswordCipher { get; set; } = "";
    public string SmtpFrom { get; set; } = "";
    public string SmtpFromName { get; set; } = "SP 助手";
    public int CodeMinutes { get; set; } = 10;
    public bool ExposeDevCode { get; set; }
    // 每行一个来源，留空表示不限制（当前默认行为）
    public string AllowedOrigins { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}
