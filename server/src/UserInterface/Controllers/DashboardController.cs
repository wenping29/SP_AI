using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;
using SpServer.UserInterface.Filters;

namespace SpServer.UserInterface.Controllers;

// 仪表盘：近 24 小时口径的调用、消耗、活跃与最近流水
[ApiController]
[Route("api/admin")]
public sealed class DashboardController(AppDbContext db) : ControllerBase
{
    [HttpGet("stats")]
    [AdminPermission("dashboard.view")]
    public async Task<IActionResult> Stats(CancellationToken ct)
    {
        // 用近 24 小时而不是自然日，避免服务器 UTC 与国内时区不一致导致“今日”口径漂移
        var since = DateTime.UtcNow.AddHours(-24);
        var accounts = await db.Accounts.CountAsync(ct);
        var totalBalance = await db.Accounts.SumAsync(a => (int?)a.Balance, ct) ?? 0;
        var blocked = await db.Accounts.CountAsync(a => a.IsBlocked, ct);
        var modelCount = await db.Models.CountAsync(m => !m.IsDeprecated, ct);
        var enabledModels = await db.Models.CountAsync(m => m.IsEnabled && !m.IsDeprecated, ct);
        // 只统计真实消耗；后台手工增减/设值不算用户消费
        var calls24h = await db.Transactions
            .CountAsync(t => t.CreatedAt >= since && t.Delta < 0 && t.Reason != "admin_grant"
                && t.Reason != "admin_set", ct);
        var consumed24h = -(await db.Transactions
            .Where(t => t.CreatedAt >= since && t.Delta < 0 && t.Reason != "admin_grant"
                && t.Reason != "admin_set")
            .SumAsync(t => (int?)t.Delta, ct) ?? 0);
        var active24h = await db.Accounts.CountAsync(a => a.LastUsedAt >= since, ct);

        var recentRows = await (from t in db.Transactions.AsNoTracking()
                                join a in db.Accounts.AsNoTracking() on t.AccountId equals a.Id
                                orderby t.Id descending
                                select new
                                {
                                    t.Id, a.DeviceId, a.Label, t.Delta, t.Reason, t.ModelId,
                                    t.InputTokens, t.OutputTokens, t.CreatedAt,
                                })
                               .Take(10)
                               .ToListAsync(ct);

        var recent = recentRows.Select(t => new
        {
            t.Id, t.DeviceId, t.Label, t.Delta, t.Reason, t.ModelId,
            t.InputTokens, t.OutputTokens, CreatedAt = ApiHelpers.AsUtc(t.CreatedAt),
        });

        return Ok(new
        {
            accounts, totalBalance, blocked, modelCount, enabledModels,
            calls24h, consumed24h, active24h, recent,
        });
    }
}
