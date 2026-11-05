using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Infrastructure;
using SpServer.UserInterface.Filters;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 积分管理：手工增减/设为指定余额、汇总（手工调账不计入消费）
[ApiController]
[Route("api/admin")]
public sealed class CreditsAdminController(AppDbContext db, CreditService credits) : ControllerBase
{
    [HttpPost("grant")]
    [AdminPermission("devices.manage")]
    public async Task<IActionResult> Grant([FromBody] GrantRequest req, CancellationToken ct)
    {
        var account = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == req.DeviceId, ct)
            ?? throw new ApiException(404, "account_not_found", "设备不存在");

        var delta = req.Delta ?? 0;
        if (delta == 0) throw new ApiException(400, "invalid_delta", "调整数量不能为 0");
        if (delta < 0 && account.Balance + delta < 0)
        {
            throw new ApiException(400, "balance_below_zero",
                $"扣减后余额会变成 {account.Balance + delta}，请减少扣减数量");
        }

        await credits.AdjustBalanceAsync(account.Id, delta, req.Reason ?? "admin_grant", ct);
        var balance = await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
        return Ok(new { deviceId = account.DeviceId, delta, balance });
    }

    // 积分管理页汇总：积分归注册用户，匿名设备不计入
    [HttpGet("credits/summary")]
    [AdminPermission("devices.view")]
    public async Task<IActionResult> Summary(CancellationToken ct)
    {
        var users = await db.Users.CountAsync(ct);
        var accountIds = await db.Accounts.Where(a => a.UserId != null).Select(a => a.Id).ToListAsync(ct);
        var totalBalance = await db.Accounts.Where(a => a.UserId != null)
            .SumAsync(a => (int?)a.Balance, ct) ?? 0;
        var disabledUsers = await db.Users.Where(u => u.IsDisabled).Select(u => u.Id).ToListAsync(ct);
        var blockedAccounts = await db.Accounts
            .Where(a => a.UserId != null && a.IsBlocked)
            .Select(a => a.UserId!.Value)
            .ToListAsync(ct);
        var blocked = disabledUsers.Union(blockedAccounts).Count();
        var spent = -(await db.Transactions
            .Where(t => accountIds.Contains(t.AccountId) && t.Delta < 0
                && t.Reason != "admin_grant" && t.Reason != "admin_set")
            .SumAsync(t => (int?)t.Delta, ct) ?? 0);
        var calls = await db.Transactions
            .CountAsync(t => accountIds.Contains(t.AccountId) && t.Delta < 0
                && t.Reason != "admin_grant" && t.Reason != "admin_set", ct);

        return Ok(new { users, totalBalance, blocked, spent, calls });
    }

    // 直接改分：delta 为增减，balance 为设为指定余额，二者只传一个
    [HttpPost("credits/adjust")]
    [AdminPermission("devices.manage")]
    public async Task<IActionResult> Adjust([FromBody] CreditAdjustRequest req, CancellationToken ct)
    {
        var deviceId = (req.DeviceId ?? "").Trim();
        if (deviceId.Length == 0) throw new ApiException(400, "invalid_device", "缺少设备 ID");
        if ((req.Delta is null) == (req.Balance is null))
        {
            throw new ApiException(400, "invalid_adjust", "请提供 delta 或 balance 其中一个");
        }

        var account = await db.Accounts.FirstOrDefaultAsync(a => a.DeviceId == deviceId, ct)
            ?? throw new ApiException(404, "account_not_found", "用户不存在");

        int delta;
        string defaultReason;
        if (req.Balance is { } target)
        {
            if (target < 0) throw new ApiException(400, "invalid_balance", "目标余额不能为负数");
            target = Math.Min(target, 100_000_000);
            delta = target - account.Balance;
            defaultReason = "admin_set";
        }
        else
        {
            delta = req.Delta!.Value;
            defaultReason = "admin_grant";
        }

        if (delta != 0)
        {
            if (delta < 0 && account.Balance + delta < 0)
            {
                throw new ApiException(400, "balance_below_zero",
                    $"扣减后余额会变成 {account.Balance + delta}，请减少扣减数量");
            }

            var reason = string.IsNullOrWhiteSpace(req.Reason) ? defaultReason : ApiHelpers.ClampText(req.Reason, 40);
            await credits.AdjustBalanceAsync(account.Id, delta, reason, ct);
        }

        var balance = await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
        return Ok(new { deviceId = account.DeviceId, label = account.Label, delta, balance });
    }
}
