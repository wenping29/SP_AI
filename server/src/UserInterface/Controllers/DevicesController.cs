using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Infrastructure;
using SpServer.UserInterface.Filters;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 设备管理只列真实设备（匿名账号即设备）；余额与调分归登录用户，在积分管理里
[ApiController]
[Route("api/admin")]
public sealed class DevicesController(AppDbContext db) : ControllerBase
{
    [HttpGet("devices")]
    [AdminPermission("devices.view")]
    public async Task<IActionResult> List([FromQuery] string? q, [FromQuery] int? page,
        [FromQuery] int? pageSize, CancellationToken ct)
    {
        var query = db.Accounts.AsNoTracking().Where(a => a.UserId == null);

        var keyword = (q ?? "").Trim();
        if (keyword.Length > 0)
        {
            query = query.Where(a => a.DeviceId.Contains(keyword) || a.Label.Contains(keyword));
        }

        var total = await query.CountAsync(ct);
        var size = Math.Clamp(pageSize ?? 20, 1, 100);
        var current = Math.Max(page ?? 1, 1);

        var accounts = await query
            .OrderByDescending(a => a.LastUsedAt)
            .ThenByDescending(a => a.Id)
            .Skip((current - 1) * size)
            .Take(size)
            .Select(a => new
            {
                a.Id, a.DeviceId, a.Label, a.IsBlocked, a.CreatedAt, a.LastUsedAt,
            })
            .ToListAsync(ct);

        // 设备登录态指向用户计费账号，用来展示该设备当前绑定的邮箱
        var deviceIds = accounts.Select(a => a.DeviceId).ToList();
        var sessions = await db.DeviceSessions.AsNoTracking()
            .Where(s => deviceIds.Contains(s.DeviceId))
            .ToDictionaryAsync(s => s.DeviceId, ct);
        var sessionAccountIds = sessions.Values.Select(s => s.AccountId).Distinct().ToList();
        var sessionAccounts = await db.Accounts.AsNoTracking()
            .Where(a => sessionAccountIds.Contains(a.Id))
            .Select(a => new { a.Id, a.UserId })
            .ToDictionaryAsync(a => a.Id, ct);
        var userIds = sessionAccounts.Values.Where(a => a.UserId != null)
            .Select(a => a.UserId!.Value).Distinct().ToList();
        var emails = await db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.Email, ct);

        return Ok(new
        {
            total,
            page = current,
            pageSize = size,
            items = accounts.Select(a =>
            {
                var account = sessions.TryGetValue(a.DeviceId, out var session)
                    ? sessionAccounts.GetValueOrDefault(session.AccountId)
                    : null;
                var userId = account?.UserId;
                return new
                {
                    a.DeviceId, a.Label, a.IsBlocked,
                    loggedIn = userId is not null,
                    accountEmail = userId is null ? "" : emails.GetValueOrDefault(userId.Value, ""),
                    CreatedAt = ApiHelpers.AsUtc(a.CreatedAt), LastUsedAt = ApiHelpers.AsUtc(a.LastUsedAt),
                };
            }),
        });
    }

    [HttpGet("devices/{deviceId}/transactions")]
    [AdminPermission("devices.view")]
    public async Task<IActionResult> Transactions(string deviceId, [FromQuery] int? take,
        CancellationToken ct)
    {
        var account = await db.Accounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.DeviceId == deviceId, ct)
            ?? throw new ApiException(404, "account_not_found", "设备不存在");

        var rows = await db.Transactions.AsNoTracking()
            .Where(t => t.AccountId == account.Id)
            .OrderByDescending(t => t.Id)
            .Take(Math.Clamp(take ?? 50, 1, 200))
            .ToListAsync(ct);

        var items = rows.Select(t => new
        {
            t.Id, t.Delta, t.Reason, t.ModelId, t.InputTokens, t.OutputTokens,
            CreatedAt = ApiHelpers.AsUtc(t.CreatedAt),
        });

        return Ok(new
        {
            deviceId = account.DeviceId,
            label = account.Label,
            balance = account.Balance,
            isBlocked = account.IsBlocked,
            items,
        });
    }

    [HttpPost("devices/{deviceId}/block")]
    [AdminPermission("devices.manage")]
    public async Task<IActionResult> Block(string deviceId, [FromBody] BlockRequest req,
        CancellationToken ct)
    {
        if (req.Blocked is null) throw new ApiException(400, "invalid_block", "缺少封禁状态");

        var account = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == deviceId, ct)
            ?? throw new ApiException(404, "account_not_found", "设备不存在");

        account.IsBlocked = req.Blocked.Value;
        await db.SaveChangesAsync(ct);
        return Ok(new { deviceId = account.DeviceId, isBlocked = account.IsBlocked });
    }
}
