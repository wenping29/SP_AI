using Microsoft.AspNetCore.Mvc;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 匿名设备注册：插件首次启动换取代币与体验积分
[ApiController]
[Route("api/device")]
public sealed class DeviceController(CreditService credits) : ControllerBase
{
    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req, CancellationToken ct)
    {
        var account = await credits.RegisterDeviceAsync(req.DeviceId, req.Label ?? "", ct);
        return Ok(new { token = account.Token, balance = account.Balance, deviceId = account.DeviceId });
    }
}
