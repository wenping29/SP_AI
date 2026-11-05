using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Application;

public record EmailCodeResult(int ExpiresIn, string? DevCode);

// 邮箱注册验证码：60 秒冷却、单邮箱每小时 5 次、单 IP 每小时 20 次
public class EmailVerification(AppDbContext db, EmailSender sender, ILogger<EmailVerification> logger)
{
    private const int MaxAttempts = 5;
    private const int MaxPerEmailPerHour = 5;
    private const int MaxPerIpPerHour = 20;
    private static readonly TimeSpan Cooldown = TimeSpan.FromSeconds(60);
    private static readonly Regex EmailPattern =
        new(@"^[^@\s]+@[^@\s]+\.[^@\s]+$", RegexOptions.Compiled);

    public async Task<EmailCodeResult> SendAsync(string? email, string? ip, CancellationToken ct)
    {
        var normalized = NormalizeEmail(email);
        if (normalized.Length is 0 or > 120 || !EmailPattern.IsMatch(normalized))
        {
            throw new ApiException(400, "invalid_email", "请输入有效的邮箱地址");
        }

        var options = await sender.GetOptionsAsync(ct);
        if (!EmailSender.IsConfigured(options) && !sender.CanExposeDevCode(options))
        {
            throw new ApiException(503, "email_not_configured", "邮箱验证暂不可用，请联系管理员配置邮件服务");
        }

        if (await db.Users.AnyAsync(u => u.Email == normalized, ct))
        {
            // 不暴露邮箱是否已注册，直接提示去登录
            throw new ApiException(409, "email_exists", "该邮箱已注册，请直接登录");
        }

        var now = DateTime.UtcNow;
        var last = await db.EmailCodes.AsNoTracking()
            .Where(c => c.Email == normalized)
            .OrderByDescending(c => c.Id)
            .FirstOrDefaultAsync(ct);
        if (last is not null && now - last.CreatedAt < Cooldown)
        {
            var wait = Math.Max(1, (int)Math.Ceiling((Cooldown - (now - last.CreatedAt)).TotalSeconds));
            throw new ApiException(429, "code_too_frequent", $"发送太频繁，请 {wait} 秒后再试");
        }

        var hourAgo = now.AddHours(-1);
        if (await db.EmailCodes.CountAsync(c => c.Email == normalized && c.CreatedAt >= hourAgo, ct)
            >= MaxPerEmailPerHour)
        {
            throw new ApiException(429, "code_limit", "该邮箱今日获取验证码次数过多，请稍后再试");
        }

        var requestIp = (ip ?? "").Trim();
        if (requestIp.Length > 64) requestIp = requestIp[..64];
        if (requestIp.Length > 0 &&
            await db.EmailCodes.CountAsync(c => c.RequestIp == requestIp && c.CreatedAt >= hourAgo, ct)
            >= MaxPerIpPerHour)
        {
            throw new ApiException(429, "code_limit", "当前网络获取验证码次数过多，请稍后再试");
        }

        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        var salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        var minutes = Math.Clamp(options.CodeMinutes, 1, 30);
        var row = new EmailCode
        {
            Email = normalized,
            CodeHash = Hash(code, salt),
            Salt = salt,
            RequestIp = requestIp,
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(minutes),
        };
        db.EmailCodes.Add(row);

        await db.EmailCodes.Where(c => c.CreatedAt < now.AddDays(-2)).ExecuteDeleteAsync(ct);
        await db.SaveChangesAsync(ct);

        try
        {
            await sender.SendVerificationCodeAsync(normalized, code, options, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "发送注册验证码失败 {Email}", normalized);
            db.EmailCodes.Remove(row);
            await db.SaveChangesAsync(CancellationToken.None);
            throw new ApiException(502, "email_send_failed", "验证码邮件发送失败，请稍后再试");
        }

        return new EmailCodeResult(minutes * 60,
            EmailSender.IsConfigured(options) || !options.ExposeDevCode ? null : code);
    }

    public async Task VerifyAndConsumeAsync(string? email, string? code, CancellationToken ct)
    {
        var normalized = NormalizeEmail(email);
        var value = (code ?? "").Trim();
        if (value.Length != 6 || !value.All(char.IsAsciiDigit))
        {
            throw new ApiException(400, "code_required", "请输入 6 位邮箱验证码");
        }

        var now = DateTime.UtcNow;
        var row = await db.EmailCodes
            .Where(c => c.Email == normalized && c.ConsumedAt == null)
            .OrderByDescending(c => c.Id)
            .FirstOrDefaultAsync(ct);
        if (row is null)
        {
            throw new ApiException(400, "code_invalid", "验证码不正确，请重新获取");
        }
        if (row.ExpiresAt <= now)
        {
            throw new ApiException(400, "code_expired", "验证码已过期，请重新获取");
        }
        if (row.Attempts >= MaxAttempts)
        {
            throw new ApiException(400, "code_attempts", "验证码错误次数过多，请重新获取");
        }

        var expected = Encoding.UTF8.GetBytes(row.CodeHash);
        var actual = Encoding.UTF8.GetBytes(Hash(value, row.Salt));
        if (expected.Length != actual.Length ||
            !CryptographicOperations.FixedTimeEquals(expected, actual))
        {
            row.Attempts++;
            await db.SaveChangesAsync(ct);
            throw new ApiException(400, "code_invalid", "验证码不正确，请重新获取");
        }

        row.ConsumedAt = now;
        await db.SaveChangesAsync(ct);
    }

    private static string Hash(string code, string salt) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{salt}:{code}")));

    private static string NormalizeEmail(string? email) => (email ?? "").Trim().ToLowerInvariant();
}
