using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Application;

public class CreditService(AppDbContext db)
{
    // 未登录设备的体验额度；登录/注册时随匿名账号余额一并并入用户账号
    public const int TrialCredits = 200;

    public async Task<CreditPolicy> GetPolicyAsync(CancellationToken ct) =>
        await db.Policies.FirstAsync(ct);

    public async Task<Account> RegisterDeviceAsync(string deviceId, string label, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(deviceId) || deviceId.Length < 8)
        {
            throw new ApiException(400, "invalid_device", "deviceId 长度不足");
        }

        var existing = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == deviceId, ct);
        if (existing is not null) return existing;

        // 新设备先给匿名体验额度；登录/注册时并入用户账号，注册赠送仍只认邮箱验证
        var now = DateTime.UtcNow;
        var account = new Account
        {
            DeviceId = deviceId,
            Label = label,
            Token = Guid.NewGuid().ToString("N"),
            Balance = TrialCredits,
            CreatedAt = now,
            LastUsedAt = now,
        };

        db.Accounts.Add(account);
        await db.SaveChangesAsync(ct);

        db.Transactions.Add(new CreditTransaction
        {
            AccountId = account.Id,
            Delta = TrialCredits,
            Reason = "device_trial",
            CreatedAt = now,
        });
        await db.SaveChangesAsync(ct);
        return account;
    }

    public async Task<Account> AuthenticateAsync(string? bearerToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(bearerToken))
        {
            throw new ApiException(401, "no_token", "缺少访问令牌");
        }

        // 登录用户的令牌存在 DeviceSessions，匿名设备仍用 Account.Token
        var session = await db.DeviceSessions.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Token == bearerToken, ct);
        var account = session is null
            ? await db.Accounts.FirstOrDefaultAsync(a => a.Token == bearerToken, ct)
            : await db.Accounts.FirstOrDefaultAsync(a => a.Id == session.AccountId, ct);

        if (account is null)
        {
            throw new ApiException(401, "bad_token", "令牌无效，请在扩展设置里重新注册设备");
        }

        if (account.IsBlocked) throw new ApiException(403, "blocked", "该账号已被封禁");
        return account;
    }

    /// 预扣：原子条件更新，余额不足直接失败，避免并发双花
    public async Task ReserveAsync(int accountId, int amount, CancellationToken ct)
    {
        if (amount <= 0) return;

        var affected = await db.Accounts
            .Where(a => a.Id == accountId && a.Balance >= amount)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.Balance, a => a.Balance - amount), ct);

        if (affected == 0)
        {
            var balance = await db.Accounts.Where(a => a.Id == accountId).Select(a => a.Balance).FirstAsync(ct);
            throw new ApiException(402, "insufficient_credits", $"积分不足，本次需要 {amount}，当前余额 {balance}");
        }
    }

    /// 结算：按实际用量计费，多预扣的部分退回
    public async Task<int> SettleAsync(Account account, ModelSpec model, int reserved, int inputTokens,
        int outputTokens, string reason, CancellationToken ct)
    {
        var actual = TokenEstimator.Charge(inputTokens, model.InputRatePer1K)
                   + TokenEstimator.Charge(outputTokens, model.OutputRatePer1K);
        var refund = reserved - actual;

        if (refund != 0)
        {
            await db.Accounts.Where(a => a.Id == account.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.Balance, a => a.Balance + refund), ct);
        }

        var balance = await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
        if (actual > 0)
        {
            db.Transactions.Add(new CreditTransaction
            {
                AccountId = account.Id,
                Delta = -actual,
                Reason = reason,
                ModelId = model.ModelId,
                InputTokens = inputTokens,
                OutputTokens = outputTokens,
                CreatedAt = DateTime.UtcNow,
            });
        }
        await db.Accounts.Where(a => a.Id == account.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.LastUsedAt, a => DateTime.UtcNow), ct);
        await db.SaveChangesAsync(ct);

        return balance;
    }

    /// 按次计费（语音输入这类没有 token 口径的调用）：先扣成功再落流水，余额不足直接失败
    public async Task<int> ChargeFixedAsync(Account account, int cost, string reason, string modelId, CancellationToken ct)
    {
        if (cost <= 0)
        {
            return await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
        }

        var affected = await db.Accounts
            .Where(a => a.Id == account.Id && a.Balance >= cost)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.Balance, a => a.Balance - cost), ct);

        if (affected == 0)
        {
            var balance = await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
            throw new ApiException(402, "insufficient_credits", $"积分不足，本次需要 {cost}，当前余额 {balance}");
        }

        db.Transactions.Add(new CreditTransaction
        {
            AccountId = account.Id,
            Delta = -cost,
            Reason = reason,
            ModelId = modelId,
            CreatedAt = DateTime.UtcNow,
        });
        await db.Accounts.Where(a => a.Id == account.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.LastUsedAt, a => DateTime.UtcNow), ct);
        await db.SaveChangesAsync(ct);

        return await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
    }

    public Task<List<CreditTransaction>> HistoryAsync(int accountId, int take, CancellationToken ct) =>
        db.Transactions.Where(t => t.AccountId == accountId)
            .OrderByDescending(t => t.Id)
            .Take(Math.Clamp(take, 1, 200))
            .ToListAsync(ct);

    /// 后台手工增减积分（发奖、补偿、充值到账都走这里）
    public async Task AdjustBalanceAsync(int accountId, int delta, string reason, CancellationToken ct)
    {
        await db.Accounts.Where(a => a.Id == accountId)
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.Balance, a => a.Balance + delta), ct);

        db.Transactions.Add(new CreditTransaction
        {
            AccountId = accountId,
            Delta = delta,
            Reason = reason,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync(ct);
    }
}
