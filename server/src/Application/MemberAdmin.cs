using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Application;

public record MemberView(int Id, string Email, string DisplayName, bool IsBlocked, int Balance,
    int Spent, int Calls, string AccountDeviceId, int DeviceCount, DateTime CreatedAt,
    DateTime? LastLoginAt);

public record MemberPage(int Total, int Page, int PageSize, IReadOnlyList<MemberView> Items);

// 插件端注册的普通用户：与后台管理员分表，积分归用户的计费账号
public class MemberAdmin(AppDbContext db)
{
    private static readonly PasswordHasher<User> Hasher = new();
    private static readonly Regex EmailPattern =
        new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

    public async Task<MemberPage> ListAsync(string? q, int page, int pageSize, CancellationToken ct)
    {
        var query = db.Users.AsNoTracking();

        var term = (q ?? "").Trim();
        if (term.Length > 0)
        {
            query = query.Where(u => u.Email.Contains(term) || u.DisplayName.Contains(term));
        }

        var total = await query.CountAsync(ct);
        var current = Math.Max(1, page);
        var size = Math.Clamp(pageSize, 1, 100);

        var users = await query
            .OrderByDescending(u => u.CreatedAt).ThenByDescending(u => u.Id)
            .Skip((current - 1) * size).Take(size)
            .ToListAsync(ct);

        var ids = users.Select(u => u.Id).ToList();
        var accounts = await db.Accounts.AsNoTracking()
            .Where(a => a.UserId != null && ids.Contains(a.UserId.Value))
            .ToListAsync(ct);
        var accountIds = accounts.Select(a => a.Id).ToList();
        var deviceCounts = await db.DeviceSessions.AsNoTracking()
            .Where(s => accountIds.Contains(s.AccountId))
            .GroupBy(s => s.AccountId)
            .Select(g => new { AccountId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.AccountId, x => x.Count, ct);
        var usage = accountIds.Count == 0
            ? new Dictionary<int, (int Spent, int Calls)>()
            : (await db.Transactions.AsNoTracking()
                .Where(t => accountIds.Contains(t.AccountId) && t.Delta < 0
                    && t.Reason != "admin_grant" && t.Reason != "admin_set")
                .GroupBy(t => t.AccountId)
                .Select(g => new { AccountId = g.Key, Spent = -g.Sum(t => t.Delta), Calls = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(x => x.AccountId, x => (x.Spent, x.Calls));

        var items = users.Select(u =>
        {
            var account = accounts.FirstOrDefault(a => a.UserId == u.Id);
            var used = account is null ? (0, 0) : usage.GetValueOrDefault(account.Id);
            return new MemberView(
                u.Id,
                u.Email,
                u.DisplayName,
                u.IsDisabled || account?.IsBlocked == true,
                account?.Balance ?? 0,
                used.Item1,
                used.Item2,
                account?.DeviceId ?? "",
                account is null ? 0 : deviceCounts.GetValueOrDefault(account.Id),
                AsUtc(u.CreatedAt),
                AsUtcOrNull(u.LastLoginAt));
        }).ToList();

        return new MemberPage(total, current, size, items);
    }

    public async Task<MemberView> CreateAsync(string? email, string? displayName, string? password,
        CancellationToken ct)
    {
        var normalized = NormalizeEmail(email);
        if (normalized.Length is 0 or > 120 || !EmailPattern.IsMatch(normalized))
        {
            throw new ApiException(400, "invalid_email", "请输入有效的邮箱地址");
        }

        if (await db.Users.AnyAsync(u => u.Email == normalized, ct))
        {
            throw new ApiException(409, "email_exists", "该邮箱已注册");
        }

        ValidatePassword(password);

        var now = DateTime.UtcNow;
        var user = new User
        {
            Email = normalized,
            DisplayName = NormalizeName(displayName, normalized),
            CreatedAt = now,
        };
        user.PasswordHash = Hasher.HashPassword(user, password!);
        db.Users.Add(user);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // 并发新增时的唯一索引兜底
            throw new ApiException(409, "email_exists", "该邮箱已注册");
        }

        var account = new Account
        {
            DeviceId = "u" + Guid.NewGuid().ToString("N"),
            Token = NewToken(),
            Label = normalized,
            Balance = 0,
            UserId = user.Id,
            CreatedAt = now,
            LastUsedAt = now,
        };
        db.Accounts.Add(account);
        await db.SaveChangesAsync(ct);

        return new MemberView(user.Id, user.Email, user.DisplayName, false, 0, 0, 0,
            account.DeviceId, 0, AsUtc(now), null);
    }

    public async Task<MemberView> UpdateAsync(int id, string? email, string? displayName, string? password,
        CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct)
            ?? throw new ApiException(404, "member_not_found", "用户不存在");

        if (email is not null)
        {
            var normalized = NormalizeEmail(email);
            if (normalized.Length is 0 or > 120 || !EmailPattern.IsMatch(normalized))
            {
                throw new ApiException(400, "invalid_email", "请输入有效的邮箱地址");
            }

            if (normalized != user.Email)
            {
                if (await db.Users.AnyAsync(u => u.Id != id && u.Email == normalized, ct))
                {
                    throw new ApiException(409, "email_exists", "该邮箱已被其他用户使用");
                }

                user.Email = normalized;
            }
        }

        if (displayName is not null) user.DisplayName = NormalizeName(displayName, user.Email);

        if (!string.IsNullOrEmpty(password))
        {
            ValidatePassword(password);
            user.PasswordHash = Hasher.HashPassword(user, password);
        }

        await db.SaveChangesAsync(ct);
        return await ViewOfAsync(user, ct);
    }

    public async Task<MemberView> BlockAsync(int id, bool blocked, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct)
            ?? throw new ApiException(404, "member_not_found", "用户不存在");

        user.IsDisabled = blocked;
        var account = await db.Accounts.FirstOrDefaultAsync(a => a.UserId == user.Id, ct);
        if (account is not null) account.IsBlocked = blocked;

        await db.SaveChangesAsync(ct);
        return await ViewOfAsync(user, ct);
    }

    public async Task DeleteAsync(int id, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct)
            ?? throw new ApiException(404, "member_not_found", "用户不存在");

        var accounts = await db.Accounts.Where(a => a.UserId == id).ToListAsync(ct);
        var accountIds = accounts.Select(a => a.Id).ToList();

        // 设备登录态回落到本机匿名账号，令牌保留，插件端不会因此掉线
        var sessions = await db.DeviceSessions
            .Where(s => accountIds.Contains(s.AccountId)).ToListAsync(ct);
        foreach (var session in sessions)
        {
            session.AccountId = session.AnonAccountId;
        }

        await db.Transactions.Where(t => accountIds.Contains(t.AccountId)).ExecuteDeleteAsync(ct);
        db.Accounts.RemoveRange(accounts);
        db.Users.Remove(user);
        await db.SaveChangesAsync(ct);
    }

    private async Task<MemberView> ViewOfAsync(User user, CancellationToken ct)
    {
        var account = await db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.UserId == user.Id, ct);
        var devices = account is null
            ? 0
            : await db.DeviceSessions.CountAsync(s => s.AccountId == account.Id, ct);
        var usage = account is null
            ? new { Spent = 0, Calls = 0 }
            : await db.Transactions.AsNoTracking()
                .Where(t => t.AccountId == account.Id && t.Delta < 0
                    && t.Reason != "admin_grant" && t.Reason != "admin_set")
                .GroupBy(t => t.AccountId)
                .Select(g => new { Spent = -g.Sum(t => t.Delta), Calls = g.Count() })
                .FirstOrDefaultAsync(ct) ?? new { Spent = 0, Calls = 0 };

        return new MemberView(user.Id, user.Email, user.DisplayName,
            user.IsDisabled || account?.IsBlocked == true, account?.Balance ?? 0,
            usage.Spent, usage.Calls, account?.DeviceId ?? "", devices,
            AsUtc(user.CreatedAt), AsUtcOrNull(user.LastLoginAt));
    }

    private static void ValidatePassword(string? password)
    {
        var value = password ?? "";
        if (value.Length < 8) throw new ApiException(400, "weak_password", "密码至少 8 位");
        if (value.Length > 72) throw new ApiException(400, "weak_password", "密码最长 72 位");
    }

    private static string NormalizeEmail(string? email) => (email ?? "").Trim().ToLowerInvariant();

    private static string NormalizeName(string? name, string email)
    {
        var value = (name ?? "").Trim();
        if (value.Length == 0) value = email.Split('@')[0];
        return value.Length <= 32 ? value : value[..32];
    }

    private static string NewToken() => Convert.ToBase64String(
            System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
        .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    private static DateTime AsUtc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static DateTime? AsUtcOrNull(DateTime value) =>
        value == default ? null : DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
