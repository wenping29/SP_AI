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

// 充值套餐：后台可改价格与积分；下单时金额与积分写入订单快照，调价不影响历史订单
public class CreditPackage
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    // 价格以分为单位，避免浮点误差
    public int PriceCents { get; set; }
    public int Credits { get; set; }
    public string Note { get; set; } = "";
    public int SortOrder { get; set; }
    public bool IsEnabled { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

// 充值订单：pending → paid / closed；paid 只能由支付回调或模拟支付确认触发一次
public class PaymentOrder
{
    public int Id { get; set; }
    public string OrderNo { get; set; } = "";
    public int UserId { get; set; }
    // 入账账号，与 UserId 对应；积分归用户，不跟设备
    public int AccountId { get; set; }
    public int PackageId { get; set; }
    public string PackageName { get; set; } = "";
    public int PriceCents { get; set; }
    public int Credits { get; set; }
    // alipay / wechat
    public string Channel { get; set; } = "";
    // mock / epay
    public string Provider { get; set; } = "";
    public string Status { get; set; } = "pending";
    // 渠道返回的收银台地址与二维码内容；mock 均为空
    public string PayUrl { get; set; } = "";
    public string QrContent { get; set; } = "";
    public string ExternalOrderNo { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? PaidAt { get; set; }
}

// 支付配置：单行表；易支付密钥只存密文与尾号
public class PaymentSetting
{
    public int Id { get; set; } = 1;
    public bool Enabled { get; set; }
    // mock：本地联调；epay：第三方聚合（支付宝/微信扫码）
    public string Provider { get; set; } = "mock";
    // 仅 Provider=mock 时生效，生产默认关闭
    public bool MockEnabled { get; set; }
    // 易支付接口地址，例如 https://pay.example.com/mapi.php
    public string EpayApiUrl { get; set; } = "";
    public string EpayPid { get; set; } = "";
    public string EpayKeyCipher { get; set; } = "";
    public string EpayKeyTail { get; set; } = "";
    public bool AlipayEnabled { get; set; } = true;
    public bool WechatEnabled { get; set; } = true;
    // 支付回调对外地址，例如 https://sp.example.com；留空时按当前请求地址生成
    public string NotifyBaseUrl { get; set; } = "";
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
