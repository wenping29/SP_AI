using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using SpServer.Data;
using SpServer.Domain;

namespace SpServer.Services;

public record ProviderKeyStatus(string Provider, string Source, string MaskedTail, DateTime? UpdatedAt, bool EnvOverride);

// 密钥优先读环境变量，其次读库里的加密副本；明文只在内存里出现，不写日志、不进流水
public class ProviderKey(AppDbContext db, IConfiguration config, IDataProtectionProvider protection,
    ILogger<ProviderKey> logger)
{
    private const string Purpose = "SpServer.ProviderKeys.v1";

    public string EnvName(string provider) =>
        config[$"Providers:{provider}:KeyEnv"] is { Length: > 0 } name
            ? name
            : $"{provider.ToUpperInvariant()}_API_KEY";

    public bool EnvConfigured(string provider) =>
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName(provider)));

    public async Task<string?> ResolveAsync(string provider, CancellationToken ct)
    {
        var envName = EnvName(provider);
        var fromEnv = Environment.GetEnvironmentVariable(envName);
        if (!string.IsNullOrWhiteSpace(fromEnv)) return fromEnv;

        var row = await db.ProviderCredentials.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Provider == provider, ct);
        if (row is null || string.IsNullOrWhiteSpace(row.Cipher))
        {
            logger.LogWarning("提供商 {Provider} 未配置密钥（环境变量 {EnvName} 为空，库里也没有记录）",
                provider, envName);
            return null;
        }

        try
        {
            return protection.CreateProtector(Purpose).Unprotect(row.Cipher);
        }
        catch (CryptographicException ex)
        {
            // 密钥环丢失或被替换后旧密文解不开，只能让管理员重新提交一次
            logger.LogError(ex, "提供商 {Provider} 的数据库密钥解密失败，需重新设置", provider);
            return null;
        }
    }

    public async Task<ProviderKeyStatus> SaveAsync(string provider, string? plaintext, CancellationToken ct)
    {
        if (!config.GetSection($"Providers:{provider}").Exists())
        {
            throw new ApiException(404, "unknown_provider", $"未知的提供商 {provider}");
        }

        var key = (plaintext ?? "").Trim();
        if (key.Length < 8) throw new ApiException(400, "invalid_key", "密钥格式不正确（长度不足）");

        var row = await db.ProviderCredentials.FirstOrDefaultAsync(c => c.Provider == provider, ct);
        if (row is null)
        {
            row = new ProviderCredential { Provider = provider };
            db.ProviderCredentials.Add(row);
        }

        row.Cipher = protection.CreateProtector(Purpose).Protect(key);
        row.MaskedTail = key[^4..];
        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        logger.LogInformation("提供商 {Provider} 的密钥已更新（尾号 {Tail}）", provider, row.MaskedTail);
        return Status(row);
    }

    public async Task<IReadOnlyList<ProviderKeyStatus>> ListAsync(CancellationToken ct)
    {
        var rows = await db.ProviderCredentials.AsNoTracking()
            .ToDictionaryAsync(c => c.Provider, ct);

        return config.GetSection("Providers").GetChildren().Select(section =>
            rows.TryGetValue(section.Key, out var row)
                ? Status(row)
                : new ProviderKeyStatus(section.Key, EnvConfigured(section.Key) ? "env" : "none", "", null,
                    EnvConfigured(section.Key))).ToList();
    }

    private ProviderKeyStatus Status(ProviderCredential row)
    {
        var envOverride = EnvConfigured(row.Provider);
        var masked = string.IsNullOrEmpty(row.MaskedTail) ? "" : $"****{row.MaskedTail}";
        return new ProviderKeyStatus(row.Provider, envOverride ? "env" : "database", masked, row.UpdatedAt,
            envOverride);
    }
}
