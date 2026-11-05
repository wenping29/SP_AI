using Microsoft.AspNetCore.Mvc;
using SpServer.Application;
using SpServer.Domain;

namespace SpServer.UserInterface.Controllers;

// 插件端积分余额与最近流水
[ApiController]
[Route("api")]
public sealed class CreditsController(CreditService credits) : ControllerBase
{
    [HttpGet("credits")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var account = await credits.AuthenticateAsync(ApiHelpers.Bearer(Request), ct);
        var history = await credits.HistoryAsync(account.Id, 30, ct);

        return Ok(new
        {
            balance = account.Balance,
            deviceId = account.DeviceId,
            transactions = history.Select(t => new
            {
                t.Delta, t.Reason, t.ModelId, t.InputTokens, t.OutputTokens,
                at = t.CreatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss"),
            }),
        });
    }
}
