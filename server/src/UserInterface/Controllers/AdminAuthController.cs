using Microsoft.AspNetCore.Mvc;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.UserInterface.Filters;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 后台登录入口必须放在鉴权之外；Admin__Key 仍是应急总钥匙
[ApiController]
[Route("api/admin/auth")]
public sealed class AdminAuthController(AdminAuth auth) : ControllerBase
{
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] AdminLoginRequest req, CancellationToken ct)
    {
        var (token, expiresAt, identity) = await auth.LoginAsync(req.Username ?? "", req.Password ?? "", ct);
        return Ok(new { token, expiresAt, user = AdminAuth.ToView(identity) });
    }

    [HttpGet("me")]
    [AdminPermission]
    public IActionResult Me() => Ok(AdminAuth.ToView(ApiHelpers.CurrentAdmin(HttpContext)));

    [HttpPost("logout")]
    [AdminPermission]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        await auth.LogoutAsync(Request, ct);
        return Ok(new { ok = true });
    }
}
