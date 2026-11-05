using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Application;

// 权限键与后台角色页的模块列表一一对应；module.manage 隐含 module.view
public static class AdminPermissions
{
    public const string All = "*";

    public static readonly string[] Keys =
    [
        "dashboard.view",
        "devices.view", "devices.manage",
        "models.view", "models.manage",
        "policy.view", "policy.manage",
        "keyenvs.view", "keyenvs.manage",
        "users.view", "users.manage",
        "admins.view", "admins.manage",
        "roles.view", "roles.manage",
        "server.view", "server.manage",
    ];

    public static bool IsValid(string key) => key == All || Keys.Contains(key);
}

public sealed record AdminIdentity(int? UserId, string Username, string DisplayName, string RoleName,
    IReadOnlySet<string> PermissionSet, string Source)
{
    public bool IsSuper => PermissionSet.Contains(AdminPermissions.All);

    public bool Has(string permission) =>
        IsSuper || PermissionSet.Contains(permission) ||
        (permission.EndsWith(".view", StringComparison.Ordinal) &&
         PermissionSet.Contains(permission[..^5] + ".manage"));
}

public record AdminIdentityView(int? Id, string Username, string DisplayName, string RoleName,
    string[] Permissions, string Source);

// 管理员登录与会话；Admin__Key 作为应急总钥匙保留
public class AdminAuth(AppDbContext db, IConfiguration config, ILogger<AdminAuth> logger)
{
    public const string IdentityItem = "sp_admin_identity";
    private static readonly PasswordHasher<AdminUser> Hasher = new();
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromHours(12);

    public bool KeyConfigured => !string.IsNullOrWhiteSpace(config["Admin:Key"]);

    public bool IsAdminKey(string? provided)
    {
        var configured = config["Admin:Key"];
        if (string.IsNullOrWhiteSpace(configured) || string.IsNullOrEmpty(provided)) return false;

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(configured));
    }

    public static AdminIdentity KeyIdentity() => new(null, "admin-key", "应急管理密钥", "Admin__Key",
        new HashSet<string> { AdminPermissions.All }, "key");

    public static string[] ParsePermissions(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<string[]>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static AdminIdentityView ToView(AdminIdentity identity) => new(
        identity.UserId,
        identity.Username,
        identity.DisplayName,
        identity.RoleName,
        identity.PermissionSet.OrderBy(p => p).ToArray(),
        identity.Source);

    public async Task<(string Token, DateTime ExpiresAt, AdminIdentity Identity)> LoginAsync(string username,
        string password, CancellationToken ct)
    {
        var name = (username ?? "").Trim();
        if (name.Length == 0 || string.IsNullOrEmpty(password))
        {
            throw new ApiException(401, "bad_credentials", "用户名或密码不正确");
        }

        var lowered = name.ToLower();
        var user = await db.AdminUsers.FirstOrDefaultAsync(u => u.Username.ToLower() == lowered, ct);
        if (user is null || user.IsDisabled)
        {
            throw new ApiException(401, "bad_credentials", "用户名或密码不正确");
        }

        var verification = Hasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (verification == PasswordVerificationResult.Failed)
        {
            throw new ApiException(401, "bad_credentials", "用户名或密码不正确");
        }

        if (verification == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = Hasher.HashPassword(user, password);
        }

        var role = await db.AdminRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == user.RoleId, ct);
        var now = DateTime.UtcNow;
        await db.AdminSessions.Where(s => s.ExpiresAt <= now).ExecuteDeleteAsync(ct);

        var token = NewToken();
        db.AdminSessions.Add(new AdminSession
        {
            UserId = user.Id,
            TokenHash = HashToken(token),
            CreatedAt = now,
            ExpiresAt = now + SessionLifetime,
        });

        user.LastLoginAt = now;
        await db.SaveChangesAsync(ct);
        logger.LogInformation("管理员 {Username} 登录成功", user.Username);

        return (token, now + SessionLifetime, IdentityOf(user, role));
    }

    public async Task<AdminIdentity?> ResolveAsync(HttpRequest request, CancellationToken ct)
    {
        var key = request.Headers["X-Admin-Key"].ToString();
        if (!string.IsNullOrEmpty(key) && IsAdminKey(key)) return KeyIdentity();

        var token = request.Headers["X-Admin-Token"].ToString().Trim();
        if (token.Length == 0)
        {
            var authorization = request.Headers.Authorization.ToString();
            if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                token = authorization[7..].Trim();
            }
        }

        if (token.Length == 0) return null;

        var hash = HashToken(token);
        var now = DateTime.UtcNow;
        var session = await db.AdminSessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.TokenHash == hash, ct);
        if (session is null || session.ExpiresAt <= now) return null;

        var user = await db.AdminUsers.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == session.UserId && !u.IsDisabled, ct);
        if (user is null) return null;

        var role = await db.AdminRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == user.RoleId, ct);
        return IdentityOf(user, role);
    }

    public async Task LogoutAsync(HttpRequest request, CancellationToken ct)
    {
        var token = request.Headers["X-Admin-Token"].ToString().Trim();
        if (token.Length == 0) return;

        var hash = HashToken(token);
        await db.AdminSessions.Where(s => s.TokenHash == hash).ExecuteDeleteAsync(ct);
    }

    public async Task RevokeSessionsAsync(int userId, CancellationToken ct) =>
        await db.AdminSessions.Where(s => s.UserId == userId).ExecuteDeleteAsync(ct);

    public string HashPassword(AdminUser user, string password) => Hasher.HashPassword(user, password);

    public static AdminIdentity IdentityOf(AdminUser user, AdminRole? role) => new(
        user.Id,
        user.Username,
        user.DisplayName,
        role?.Name ?? "未分配",
        (role is null ? [] : ParsePermissions(role.Permissions)).ToHashSet(StringComparer.Ordinal),
        "user");

    private static string NewToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}
