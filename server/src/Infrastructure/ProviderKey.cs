using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Infrastructure;

public record ProviderInfo(string Provider, string BaseUrl, string DefaultEnvName);

public record KeyEnvView(
    int Id,
    string Provider,
    string EnvName,
    string MaskedTail,
    bool IsActive,
    bool IsDeprecated,
    string Note,
    string Source,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record ProviderSummary(
    string Provider,
    string BaseUrl,
    string DefaultEnvName,
    string ActiveEnvName,
    string Source,
    string MaskedTail,
    bool Usable,
    int EntryCount,
    int ActiveCount,
    int DeprecatedCount);

// KeyEnv 条目管理 + 密钥解析。明文只在内存里出现，不写日志、不进流水
public class ProviderKey(AppDbContext db, IConfiguration config, IDataProtectionProvider protection,
    ILogger<ProviderKey> logger)
{
    private const string Purpose = "SpServer.ProviderKeys.v1";
    private static readonly Regex EnvNamePattern = new("^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);

    public string EnvName(string provider) =>
        config[$"Providers:{provider}:KeyEnv"] is { Length: > 0 } name
            ? name
            : $"{provider.ToUpperInvariant()}_API_KEY";

    public bool EnvConfigured(string provider) =>
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName(provider)));

    public IReadOnlyList<ProviderInfo> Providers() =>
        config.GetSection("Providers").GetChildren()
            .Select(section => new ProviderInfo(section.Key, section["BaseUrl"] ?? "", EnvName(section.Key)))
            .ToList();

    // 把配置里的提供商名规范成配置里的原始大小写，未知提供商直接拒绝
    public string CanonicalProvider(string provider)
    {
        var canonical = Providers().FirstOrDefault(p =>
            string.Equals(p.Provider, provider?.Trim(), StringComparison.OrdinalIgnoreCase));
        return canonical?.Provider ?? throw new ApiException(404, "unknown_provider", $"未知的提供商 {provider}");
    }

    public async Task<string?> ResolveAsync(string provider, CancellationToken ct)
    {
        var entry = await db.KeyEnvs.AsNoTracking()
            .Where(e => e.Provider == provider && e.IsActive && !e.IsDeprecated)
            .FirstOrDefaultAsync(ct);

        if (entry is null) return await ResolveLegacyAsync(provider, ct);

        var fromEnv = Environment.GetEnvironmentVariable(entry.EnvName);
        if (!string.IsNullOrWhiteSpace(fromEnv)) return fromEnv;

        if (string.IsNullOrWhiteSpace(entry.Cipher))
        {
            logger.LogWarning("提供商 {Provider} 的 KeyEnv 条目 {EnvName} 没有密钥（环境变量为空，库里也没有密文）",
                provider, entry.EnvName);
            return null;
        }

        return Unprotect(provider, entry.Cipher);
    }

    // 没有 KeyEnv 条目的老库走旧逻辑，避免升级瞬间中断服务
    private async Task<string?> ResolveLegacyAsync(string provider, CancellationToken ct)
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

        return Unprotect(provider, row.Cipher);
    }

    private string? Unprotect(string provider, string cipher)
    {
        try
        {
            return protection.CreateProtector(Purpose).Unprotect(cipher);
        }
        catch (CryptographicException ex)
        {
            // 密钥环丢失或被替换后旧密文解不开，只能让管理员重新提交一次
            logger.LogError(ex, "提供商 {Provider} 的数据库密钥解密失败，需重新设置", provider);
            return null;
        }
    }

    // 只看是否有启用的 KeyEnv 条目，不试解密：密钥没填时仍下发模型，调用时再报 503
    public async Task<bool> IsUsableAsync(string provider, CancellationToken ct)
    {
        var hasEntries = await db.KeyEnvs.AsNoTracking().AnyAsync(e => e.Provider == provider, ct);
        if (hasEntries)
        {
            return await db.KeyEnvs.AsNoTracking()
                .AnyAsync(e => e.Provider == provider && e.IsActive && !e.IsDeprecated, ct);
        }

        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(EnvName(provider)))) return true;
        return await db.ProviderCredentials.AsNoTracking().AnyAsync(c => c.Provider == provider, ct);
    }

    public async Task<HashSet<string>> UsableProvidersAsync(CancellationToken ct)
    {
        var providers = Providers().Select(p => p.Provider).ToList();
        var withEntries = (await db.KeyEnvs.AsNoTracking()
                .Where(e => e.IsActive && !e.IsDeprecated)
                .Select(e => e.Provider)
                .Distinct()
                .ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var legacyRows = (await db.ProviderCredentials.AsNoTracking()
                .Select(c => c.Provider)
                .ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var allProviders = (await db.KeyEnvs.AsNoTracking()
                .Select(e => e.Provider)
                .Distinct()
                .ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var usable = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var provider in providers)
        {
            if (withEntries.Contains(provider)) usable.Add(provider);
            else if (!allProviders.Contains(provider) &&
                     (legacyRows.Contains(provider) || EnvConfigured(provider))) usable.Add(provider);
        }

        return usable;
    }

    // 只在表为空时做一次初始化（新库或老库升级），管理员删光条目后重启不会被自动补回
    public async Task EnsureSeededAsync(CancellationToken ct)
    {
        if (await db.KeyEnvs.AnyAsync(ct)) return;

        var legacy = (await db.ProviderCredentials.AsNoTracking().ToListAsync(ct))
            .ToDictionary(c => c.Provider, StringComparer.OrdinalIgnoreCase);
        var now = DateTime.UtcNow;

        foreach (var provider in Providers())
        {
            var entry = new KeyEnvEntry
            {
                Provider = provider.Provider,
                EnvName = provider.DefaultEnvName,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };

            if (legacy.TryGetValue(provider.Provider, out var row) && !string.IsNullOrWhiteSpace(row.Cipher))
            {
                entry.Cipher = row.Cipher;
                entry.MaskedTail = row.MaskedTail;
                entry.Note = "迁移自旧的单密钥配置";
            }

            db.KeyEnvs.Add(entry);
        }

        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<KeyEnvView>> ListEntriesAsync(string? provider, bool includeDeprecated,
        CancellationToken ct)
    {
        var query = db.KeyEnvs.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(provider))
        {
            var canonical = CanonicalProvider(provider);
            query = query.Where(e => e.Provider == canonical);
        }

        if (!includeDeprecated) query = query.Where(e => !e.IsDeprecated);

        var rows = await query
            .OrderBy(e => e.Provider)
            .ThenByDescending(e => e.IsActive)
            .ThenBy(e => e.Id)
            .ToListAsync(ct);

        return rows.Select(View).ToList();
    }

    public async Task<IReadOnlyList<ProviderSummary>> ListProvidersAsync(CancellationToken ct)
    {
        var entries = await db.KeyEnvs.AsNoTracking().ToListAsync(ct);
        var legacyProviders = (await db.ProviderCredentials.AsNoTracking()
                .Select(c => c.Provider)
                .ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return Providers().Select(provider =>
        {
            var mine = entries.Where(e => string.Equals(e.Provider, provider.Provider, StringComparison.OrdinalIgnoreCase))
                .ToList();
            var active = mine.FirstOrDefault(e => e.IsActive && !e.IsDeprecated);
            var usable = mine.Count > 0
                ? active is not null
                : EnvConfigured(provider.Provider) || legacyProviders.Contains(provider.Provider);

            return new ProviderSummary(
                provider.Provider,
                provider.BaseUrl,
                provider.DefaultEnvName,
                active?.EnvName ?? "",
                active is null ? "none" : SourceOf(active),
                active is null || string.IsNullOrEmpty(active.MaskedTail) ? "" : $"****{active.MaskedTail}",
                usable,
                mine.Count,
                mine.Count(e => e.IsActive && !e.IsDeprecated),
                mine.Count(e => e.IsDeprecated));
        }).ToList();
    }

    public async Task<KeyEnvView> CreateAsync(string provider, string? envName, string? plaintext, string? note,
        bool activate, CancellationToken ct)
    {
        var canonical = CanonicalProvider(provider);
        var name = NormalizeEnvName(envName, canonical);
        await EnsureEnvNameFreeAsync(canonical, name, 0, ct);

        var (cipher, tail) = Protect(plaintext);
        var now = DateTime.UtcNow;
        var entry = new KeyEnvEntry
        {
            Provider = canonical,
            EnvName = name,
            Cipher = cipher,
            MaskedTail = tail,
            Note = (note ?? "").Trim(),
            CreatedAt = now,
            UpdatedAt = now,
        };

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var hasActive = await db.KeyEnvs.AnyAsync(e =>
            e.Provider == canonical && e.IsActive && !e.IsDeprecated, ct);
        entry.IsActive = activate || !hasActive;

        if (entry.IsActive)
        {
            await DeactivateOthersAsync(canonical, 0, ct);
        }

        db.KeyEnvs.Add(entry);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        logger.LogInformation("新增 KeyEnv {Provider}/{EnvName}（尾号 {Tail}）", canonical, name, tail);
        return View(entry);
    }

    public async Task<KeyEnvView> UpdateAsync(int id, string? envName, string? plaintext, bool clearKey,
        string? note, CancellationToken ct)
    {
        var entry = await FindAsync(id, ct);
        var name = NormalizeEnvName(envName ?? entry.EnvName, entry.Provider);
        await EnsureEnvNameFreeAsync(entry.Provider, name, entry.Id, ct);

        entry.EnvName = name;
        if (clearKey)
        {
            entry.Cipher = "";
            entry.MaskedTail = "";
        }
        else if (!string.IsNullOrWhiteSpace(plaintext))
        {
            (entry.Cipher, entry.MaskedTail) = Protect(plaintext);
        }

        if (note is not null) entry.Note = note.Trim();
        entry.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return View(entry);
    }

    public async Task<KeyEnvView> ActivateAsync(int id, CancellationToken ct)
    {
        var entry = await FindAsync(id, ct);
        if (entry.IsDeprecated)
        {
            throw new ApiException(409, "deprecated_entry", "已废弃的条目不能启用，请先恢复");
        }

        if (!entry.IsActive)
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await DeactivateOthersAsync(entry.Provider, entry.Id, ct);
            entry.IsActive = true;
            entry.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }

        return View(entry);
    }

    public async Task<KeyEnvView> SetDeprecatedAsync(int id, bool deprecated, CancellationToken ct)
    {
        var entry = await FindAsync(id, ct);
        entry.IsDeprecated = deprecated;
        entry.UpdatedAt = DateTime.UtcNow;

        if (deprecated)
        {
            var wasActive = entry.IsActive;
            entry.IsActive = false;
            await db.SaveChangesAsync(ct);
            if (wasActive) await PromoteAnotherAsync(entry.Provider, entry.Id, ct);
        }
        else
        {
            // 恢复后如果该提供商没有其他启用条目，直接顶上，否则“恢复”了还是不可用
            var hasOtherActive = await db.KeyEnvs.AnyAsync(e =>
                e.Provider == entry.Provider && e.Id != entry.Id && e.IsActive && !e.IsDeprecated, ct);
            if (!hasOtherActive) entry.IsActive = true;
            await db.SaveChangesAsync(ct);
        }

        return View(entry);
    }

    public async Task DeleteAsync(int id, CancellationToken ct)
    {
        var entry = await FindAsync(id, ct);
        var wasActive = entry.IsActive;
        var provider = entry.Provider;

        db.KeyEnvs.Remove(entry);
        await db.SaveChangesAsync(ct);

        if (wasActive) await PromoteAnotherAsync(provider, id, ct);
        logger.LogInformation("删除 KeyEnv {Provider}/{EnvName}", provider, entry.EnvName);
    }

    // 兼容旧的单密钥接口：写到当前启用条目上，没有条目时按默认 EnvName 新建
    public async Task<KeyEnvView> SaveAsync(string provider, string? plaintext, CancellationToken ct)
    {
        var canonical = CanonicalProvider(provider);
        var key = (plaintext ?? "").Trim();
        if (key.Length < 8) throw new ApiException(400, "invalid_key", "密钥格式不正确（长度不足）");

        var entry = await db.KeyEnvs
            .Where(e => e.Provider == canonical && e.IsActive && !e.IsDeprecated)
            .FirstOrDefaultAsync(ct);

        if (entry is null)
        {
            return await CreateAsync(canonical, EnvName(canonical), key, "", true, ct);
        }

        (entry.Cipher, entry.MaskedTail) = Protect(key);
        entry.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        logger.LogInformation("提供商 {Provider} 的密钥已更新（尾号 {Tail}）", canonical, entry.MaskedTail);
        return View(entry);
    }

    private async Task<KeyEnvEntry> FindAsync(int id, CancellationToken ct) =>
        await db.KeyEnvs.FirstOrDefaultAsync(e => e.Id == id, ct)
        ?? throw new ApiException(404, "keyenv_not_found", "KeyEnv 条目不存在");

    private string NormalizeEnvName(string? envName, string provider)
    {
        var name = (envName ?? "").Trim();
        if (name.Length == 0) name = EnvName(provider);
        if (name.Length > 128 || !EnvNamePattern.IsMatch(name))
        {
            throw new ApiException(400, "invalid_env_name",
                "环境变量名只能包含字母、数字和下划线，且不能以数字开头");
        }

        return name;
    }

    private async Task EnsureEnvNameFreeAsync(string provider, string envName, int selfId, CancellationToken ct)
    {
        var lowered = envName.ToLower();
        var exists = await db.KeyEnvs.AnyAsync(e => e.Provider == provider && e.Id != selfId &&
                                                    e.EnvName.ToLower() == lowered, ct);
        if (exists)
        {
            throw new ApiException(409, "env_name_exists", $"该提供商下已存在环境变量 {envName}");
        }
    }

    private (string Cipher, string Tail) Protect(string? plaintext)
    {
        var key = (plaintext ?? "").Trim();
        if (key.Length == 0) return ("", "");
        if (key.Length < 8) throw new ApiException(400, "invalid_key", "密钥格式不正确（长度不足）");
        return (protection.CreateProtector(Purpose).Protect(key), key[^4..]);
    }

    private async Task DeactivateOthersAsync(string provider, int exceptId, CancellationToken ct)
    {
        var others = await db.KeyEnvs
            .Where(e => e.Provider == provider && e.Id != exceptId && e.IsActive)
            .ToListAsync(ct);
        foreach (var other in others)
        {
            other.IsActive = false;
            other.UpdatedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
    }

    // 删掉/废弃当前启用条目后，自动顶上该提供商最早的可用条目，避免服务直接中断
    private async Task PromoteAnotherAsync(string provider, int exceptId, CancellationToken ct)
    {
        var hasActive = await db.KeyEnvs.AnyAsync(e =>
            e.Provider == provider && e.Id != exceptId && e.IsActive && !e.IsDeprecated, ct);
        if (hasActive) return;

        var next = await db.KeyEnvs
            .Where(e => e.Provider == provider && e.Id != exceptId && !e.IsDeprecated)
            .OrderBy(e => e.Id)
            .FirstOrDefaultAsync(ct);
        if (next is null) return;

        next.IsActive = true;
        next.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        logger.LogInformation("提供商 {Provider} 自动切换到 KeyEnv {EnvName}", provider, next.EnvName);
    }

    private KeyEnvView View(KeyEnvEntry entry) => new(
        entry.Id,
        entry.Provider,
        entry.EnvName,
        string.IsNullOrEmpty(entry.MaskedTail) ? "" : $"****{entry.MaskedTail}",
        entry.IsActive,
        entry.IsDeprecated,
        entry.Note,
        SourceOf(entry),
        DateTime.SpecifyKind(entry.CreatedAt, DateTimeKind.Utc),
        DateTime.SpecifyKind(entry.UpdatedAt, DateTimeKind.Utc));

    private static string SourceOf(KeyEnvEntry entry)
    {
        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(entry.EnvName))) return "env";
        return string.IsNullOrWhiteSpace(entry.Cipher) ? "none" : "database";
    }
}
