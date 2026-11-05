using System.Threading;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SpServer.Domain;
using SpServer.Services;

namespace SpServer.Data;

// 把 Program.cs 里的建库、建表、补列、播种、初始管理员等初始化 SQL 统一收拢到这里，
// 启动流程只调用 DatabaseInitializer.InitializeAsync 一行即可。
public static class DatabaseInitializer
{
    public static async Task InitializeAsync(IServiceProvider services, ILogger logger,
        CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();

        db.Database.EnsureCreated();

        // EnsureCreated 只在建库时起作用，已有库不会补新表，这里幂等创建凭据表
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "ProviderCredentials" (
                "Provider" TEXT NOT NULL CONSTRAINT "PK_ProviderCredentials" PRIMARY KEY,
                "Cipher" TEXT NOT NULL,
                "MaskedTail" TEXT NOT NULL,
                "UpdatedAt" TEXT NOT NULL
            );
            """, ct);

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
            """, ct);

        // 每个提供商最多一条启用条目；EF 的 EnsureCreated 直接带上，老库靠这段补
        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                CREATE UNIQUE INDEX IF NOT EXISTS "IX_KeyEnvs_ActiveProvider"
                    ON "KeyEnvs" ("Provider") WHERE "IsActive" = 1 AND "IsDeprecated" = 0;
                """, ct);
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
            """, ct);

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
            """, ct);

        // 邮箱注册验证码：只存哈希；老用户补 EmailVerified 列并按已验证处理
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "EmailCodes" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_EmailCodes" PRIMARY KEY AUTOINCREMENT,
                "Email" TEXT NOT NULL,
                "CodeHash" TEXT NOT NULL,
                "Salt" TEXT NOT NULL,
                "RequestIp" TEXT NOT NULL,
                "Attempts" INTEGER NOT NULL,
                "CreatedAt" TEXT NOT NULL,
                "ExpiresAt" TEXT NOT NULL,
                "ConsumedAt" TEXT NULL
            );
            CREATE INDEX IF NOT EXISTS "IX_EmailCodes_Email" ON "EmailCodes" ("Email");
            CREATE INDEX IF NOT EXISTS "IX_EmailCodes_CreatedAt" ON "EmailCodes" ("CreatedAt");
            """, ct);

        try
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "Users" ADD COLUMN "EmailVerified" INTEGER NOT NULL DEFAULT 1;""", ct);
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Users.EmailVerified 列已存在，跳过补列");
        }

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
            """, ct);

        // 服务器运行配置：单行表；首次启动按 appsettings 的 Email 段播种，之后以数据库为准
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "ServerSettings" (
                "Id" INTEGER NOT NULL CONSTRAINT "PK_ServerSettings" PRIMARY KEY,
                "SmtpEnabled" INTEGER NOT NULL,
                "SmtpHost" TEXT NOT NULL,
                "SmtpPort" INTEGER NOT NULL,
                "SmtpImplicitTls" INTEGER NOT NULL,
                "SmtpUser" TEXT NOT NULL,
                "SmtpPasswordCipher" TEXT NOT NULL,
                "SmtpFrom" TEXT NOT NULL,
                "SmtpFromName" TEXT NOT NULL,
                "CodeMinutes" INTEGER NOT NULL,
                "ExposeDevCode" INTEGER NOT NULL,
                "AllowedOrigins" TEXT NOT NULL,
                "UpdatedAt" TEXT NOT NULL
            );
            """, ct);

        if (!await db.ServerSettings.AnyAsync(ct))
        {
            var email = config.GetSection("Email");
            db.ServerSettings.Add(new ServerSetting
            {
                Id = 1,
                SmtpEnabled = email.GetValue("Enabled", false),
                SmtpHost = email["Host"] ?? "",
                SmtpPort = email.GetValue("Port", 465),
                SmtpImplicitTls = email.GetValue("UseImplicitTls", true),
                SmtpUser = email["User"] ?? "",
                SmtpFrom = email["From"] ?? "",
                SmtpFromName = email["FromName"] is { Length: > 0 } name ? name : "SP 助手",
                CodeMinutes = email.GetValue("CodeMinutes", 10),
                ExposeDevCode = email.GetValue("ExposeDevCode", false),
                AllowedOrigins = "",
                UpdatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync(ct);
        }

        try
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "Accounts" ADD COLUMN "UserId" INTEGER NULL;""", ct);
        }
        catch (Exception ex)
        {
            logger.LogDebug(ex, "Accounts.UserId 列已存在，跳过补列");
        }

        try
        {
            await db.Database.ExecuteSqlRawAsync(
                """CREATE INDEX IF NOT EXISTS "IX_Accounts_UserId" ON "Accounts" ("UserId");""", ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Accounts.UserId 索引创建失败");
        }

        // 老库的 Models 表没有废弃标记，EnsureCreated 不会补列，这里单独加一次
        try
        {
            await db.Database.ExecuteSqlRawAsync(
                """ALTER TABLE "Models" ADD COLUMN "IsDeprecated" INTEGER NOT NULL DEFAULT 0;""", ct);
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
                """ALTER TABLE "Models" ADD COLUMN "Category" TEXT NOT NULL DEFAULT '';""", ct);
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
                """, ct);
        }

        await db.SeedAsync(ct);

        // 首次启动且没有任何管理员时创建初始账号；用户表非空时不再执行，重启不会覆盖已改密码
        var initialUsername = (config["Admin:InitialUsername"] ?? "").Trim();
        var initialPassword = config["Admin:InitialPassword"] ?? "";
        if (!await db.AdminUsers.AnyAsync(ct))
        {
            if (initialUsername.Length == 0 || initialPassword.Length < 8)
            {
                logger.LogWarning("未配置 Admin:InitialUsername 或 Admin:InitialPassword，跳过初始管理员创建");
            }
            else
            {
                var role = await db.AdminRoles.FirstOrDefaultAsync(r => r.IsSystem, ct)
                    ?? await db.AdminRoles.OrderBy(r => r.Id).FirstOrDefaultAsync(ct);
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
                    await db.SaveChangesAsync(ct);
                    logger.LogInformation("已创建初始管理员账号 {Username}", initialUsername);
                }
            }
        }

        await scope.ServiceProvider.GetRequiredService<ProviderKey>().EnsureSeededAsync(ct);
    }
}
