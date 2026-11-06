using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Application;

public record UserProfile(string Email, string DisplayName);

public record AuthResult(string Token, int Balance, int MergedCredits, int GiftCredits, UserProfile User,
    string AccountDeviceId);

public record MeView(bool LoggedIn, string? Email, string? DisplayName, int Balance, string AccountDeviceId);

// 普通用户账号：邮箱 + 密码。积分归账号，设备只负责拿令牌登录
public class UserAuth(AppDbContext db, EmailVerification verification, ILogger<UserAuth> logger)
{
    private static readonly PasswordHasher<User> Hasher = new();
    private static readonly Regex EmailPattern =
        new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

    public async Task<AuthResult> RegisterAsync(string? email, string? password, string? displayName,
        string? deviceId, string? label, string? code, CancellationToken ct)
    {
        var normalized = NormalizeEmail(email);
        if (normalized.Length is 0 or > 120 || !EmailPattern.IsMatch(normalized))
        {
            throw new ApiException(400, "invalid_email", "请输入有效的邮箱地址");
        }

        var pwd = password ?? "";
        if (pwd.Length < 8) throw new ApiException(400, "weak_password", "密码至少 8 位");
        if (pwd.Length > 72) throw new ApiException(400, "weak_password", "密码最长 72 位");

        if (await db.Users.AnyAsync(u => u.Email == normalized, ct))
        {
            throw new ApiException(409, "email_exists", "该邮箱已注册，请直接登录");
        }

        // 验证码在事务外校验并消费，避免并发注册时长时间占用写锁
        await verification.VerifyAndConsumeAsync(normalized, code, ct);

        var gift = (await db.Policies.AsNoTracking().FirstOrDefaultAsync(ct))?.FreeCredits ?? 0;
        gift = Math.Max(0, gift);

        var now = DateTime.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var user = new User
        {
            Email = normalized,
            DisplayName = NormalizeName(displayName, normalized),
            EmailVerified = true,
            CreatedAt = now,
            LastLoginAt = now,
        };
        user.PasswordHash = Hasher.HashPassword(user, pwd);
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // 并发注册时唯一索引兜底，避免把数据库异常暴露成 500
            await tx.RollbackAsync(ct);
            throw new ApiException(409, "email_exists", "该邮箱已注册，请直接登录");
        }

        var account = new Account
        {
            DeviceId = NewAccountId(),
            Token = NewToken(),
            Label = normalized,
            Balance = gift,
            UserId = user.Id,
            CreatedAt = now,
            LastUsedAt = now,
        };
        db.Accounts.Add(account);
        await db.SaveChangesAsync(ct);

        if (gift > 0)
        {
            db.Transactions.Add(new CreditTransaction
            {
                AccountId = account.Id,
                Delta = gift,
                Reason = "free_grant",
                CreatedAt = now,
            });
        }

        var anon = await EnsureAnonAccountAsync(deviceId, now, ct);
        await db.SaveChangesAsync(ct);
        var merged = await MergeCreditsAsync(anon, account, now, ct);
        var session = await BindSessionAsync(anon, account, label, now, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        logger.LogInformation("用户 {Email} 注册成功，赠送 {Gift} 积分，合并本机积分 {Merged}", normalized, gift,
            merged);
        return new AuthResult(session.Token, account.Balance, merged, gift, ProfileOf(user), account.DeviceId);
    }

    public async Task<AuthResult> LoginAsync(string? email, string? password, string? deviceId, string? label,
        CancellationToken ct)
    {
        var normalized = NormalizeEmail(email);
        var pwd = password ?? "";
        if (normalized.Length == 0 || pwd.Length == 0)
        {
            throw new ApiException(401, "bad_credentials", "邮箱或密码不正确");
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalized, ct);
        if (user is null || user.IsDisabled)
        {
            throw new ApiException(401, "bad_credentials", "邮箱或密码不正确");
        }
        if (!user.EmailVerified)
        {
            throw new ApiException(403, "email_not_verified", "邮箱尚未验证，请重新注册或联系管理员");
        }

        var verification = Hasher.VerifyHashedPassword(user, user.PasswordHash, pwd);
        if (verification == PasswordVerificationResult.Failed)
        {
            throw new ApiException(401, "bad_credentials", "邮箱或密码不正确");
        }
        if (verification == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = Hasher.HashPassword(user, pwd);
        }

        var now = DateTime.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var account = await db.Accounts.FirstOrDefaultAsync(a => a.UserId == user.Id, ct);
        if (account is null)
        {
            account = new Account
            {
                DeviceId = NewAccountId(),
                Token = NewToken(),
                Label = user.Email,
                Balance = 0,
                UserId = user.Id,
                CreatedAt = now,
                LastUsedAt = now,
            };
            db.Accounts.Add(account);
            await db.SaveChangesAsync(ct);
        }

        var anon = await EnsureAnonAccountAsync(deviceId, now, ct);
        await db.SaveChangesAsync(ct);
        var merged = await MergeCreditsAsync(anon, account, now, ct);
        user.LastLoginAt = now;
        var session = await BindSessionAsync(anon, account, label, now, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        logger.LogInformation("用户 {Email} 登录成功，合并本机积分 {Merged}", user.Email, merged);
        return new AuthResult(session.Token, account.Balance, merged, 0, ProfileOf(user), account.DeviceId);
    }

    // 退出登录：会话回落到本机匿名账号，换一个令牌继续可用
    public async Task<AuthResult> LogoutAsync(string? token, CancellationToken ct)
    {
        var current = await RequireSessionAsync(token, ct);
        var now = DateTime.UtcNow;

        var anon = await db.Accounts.FirstOrDefaultAsync(a => a.Id == current.AnonAccountId, ct);
        if (anon is null)
        {
            anon = await EnsureAnonAccountAsync(current.DeviceId, now, ct);
        }

        current.AccountId = anon.Id;
        current.AnonAccountId = anon.Id;
        current.Token = NewToken();
        current.LastUsedAt = now;

        await db.SaveChangesAsync(ct);

        return new AuthResult(current.Token, anon.Balance, 0, 0, new UserProfile("", ""), anon.DeviceId);
    }

    public async Task<MeView> MeAsync(string? token, CancellationToken ct)
    {
        var account = await ResolveAccountAsync(token, ct)
            ?? throw new ApiException(401, "bad_token", "登录已失效，请重新登录");
        var user = account.UserId is null
            ? null
            : await db.Users.FirstOrDefaultAsync(u => u.Id == account.UserId, ct);

        return new MeView(user is not null, user?.Email, user?.DisplayName, account.Balance,
            account.DeviceId);
    }

    public async Task<Account?> ResolveAccountAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var session = await db.DeviceSessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Token == token, ct);
        if (session is not null)
        {
            return await db.Accounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == session.AccountId, ct);
        }

        // 兼容旧版设备令牌：Account.Token 直接对账号
        return await db.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.Token == token, ct);
    }

    private async Task<DeviceSession> RequireSessionAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            throw new ApiException(401, "no_token", "缺少访问令牌");
        }

        return await db.DeviceSessions.FirstOrDefaultAsync(s => s.Token == token, ct)
            ?? throw new ApiException(401, "bad_token", "登录已失效，请重新登录");
    }

    // 把设备匿名账号的余额并入登录账号；匿名账号保留，退出后回落到它
    private async Task<int> MergeCreditsAsync(Account anon, Account target, DateTime now, CancellationToken ct)
    {
        if (anon.Id == target.Id || anon.UserId is not null) return 0;

        var moved = anon.Balance;
        if (moved <= 0) return 0;

        // 体验额度按账号只认一次：插件重装或换浏览器会换一个新的 deviceId，服务端把它当新机器再发一笔，
        // 若照单全收就等于同一账号反复领；被排除的那部分留在匿名账号里，不写流水
        var countedTrial = await db.Transactions.AnyAsync(
            t => t.AccountId == target.Id && t.Reason == "device_merge" && t.Delta > 0, ct);
        if (countedTrial)
        {
            moved -= Math.Min(CreditService.TrialCredits, moved);
            if (moved <= 0) return 0;
        }

        anon.Balance -= moved;
        target.Balance += moved;
        db.Transactions.Add(new CreditTransaction
        {
            AccountId = target.Id,
            Delta = moved,
            Reason = "device_merge",
            CreatedAt = now,
        });
        return moved;
    }

    private async Task<Account> EnsureAnonAccountAsync(string? deviceId, DateTime now, CancellationToken ct)
    {
        var id = (deviceId ?? "").Trim();
        if (id.Length < 8) throw new ApiException(400, "invalid_device", "deviceId 长度不足");

        var anon = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == id, ct);
        if (anon is not null) return anon;

        // 登录/注册时缺失匿名账号只补 0 余额：体验额度只在设备匿名注册时发放一次，避免换设备反复领取
        anon = new Account
        {
            DeviceId = id,
            Token = NewToken(),
            Label = "",
            Balance = 0,
            CreatedAt = now,
            LastUsedAt = now,
        };
        db.Accounts.Add(anon);
        return anon;
    }

    private async Task<DeviceSession> BindSessionAsync(Account anon, Account account, string? label,
        DateTime now, CancellationToken ct)
    {
        var id = anon.DeviceId;
        var session = await db.DeviceSessions.FirstOrDefaultAsync(s => s.DeviceId == id, ct);
        if (session is null)
        {
            session = new DeviceSession
            {
                DeviceId = id,
                Token = NewToken(),
                AccountId = account.Id,
                AnonAccountId = anon.Id,
                Label = ClampLabel(label),
                CreatedAt = now,
                LastUsedAt = now,
            };
            db.DeviceSessions.Add(session);
        }
        else
        {
            session.AccountId = account.Id;
            if (session.AnonAccountId == 0) session.AnonAccountId = anon.Id;
            session.Token = NewToken();
            session.Label = ClampLabel(label);
            session.LastUsedAt = now;
        }
        return session;
    }

    private static UserProfile ProfileOf(User user) => new(user.Email, user.DisplayName);

    private static string NormalizeEmail(string? email) => (email ?? "").Trim().ToLowerInvariant();

    private static string NormalizeName(string? name, string email)
    {
        var value = (name ?? "").Trim();
        if (value.Length == 0) value = email.Split('@')[0];
        return value.Length <= 32 ? value : value[..32];
    }

    private static string ClampLabel(string? label)
    {
        var value = (label ?? "").Trim();
        return value.Length <= 40 ? value : value[..40];
    }

    private static string NewAccountId() => "u" + Guid.NewGuid().ToString("N");

    private static string NewToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .Replace('+', '-').Replace('/', '_').TrimEnd('=');
}
