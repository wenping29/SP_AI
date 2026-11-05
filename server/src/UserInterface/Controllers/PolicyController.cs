using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Infrastructure;
using SpServer.UserInterface.Filters;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 运营策略：注册赠送积分、对话开关、公告
[ApiController]
[Route("api/admin")]
public sealed class PolicyController(AppDbContext db, CreditService credits) : ControllerBase
{
    [HttpGet("policy")]
    [AdminPermission("policy.view")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var policy = await credits.GetPolicyAsync(ct);
        return Ok(new
        {
            policy.FreeCredits, policy.ChatEnabled, policy.Notice,
            UpdatedAt = ApiHelpers.AsUtc(policy.UpdatedAt),
        });
    }

    [HttpPut("policy")]
    [AdminPermission("policy.manage")]
    public async Task<IActionResult> Update([FromBody] PolicyRequest req, CancellationToken ct)
    {
        var policy = await db.Policies.FirstAsync(ct);
        if (req.FreeCredits is { } freeCredits)
        {
            if (freeCredits < 0) throw new ApiException(400, "invalid_credits", "免费积分不能为负数");
            policy.FreeCredits = freeCredits;
        }

        if (req.ChatEnabled is { } chatEnabled) policy.ChatEnabled = chatEnabled;
        if (req.Notice is { } notice) policy.Notice = notice;
        policy.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
        return Ok(new
        {
            policy.FreeCredits, policy.ChatEnabled, policy.Notice,
            UpdatedAt = ApiHelpers.AsUtc(policy.UpdatedAt),
        });
    }
}
