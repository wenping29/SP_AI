using Microsoft.AspNetCore.Mvc;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 普通用户账号：注册需邮箱验证码，注册成功后积分归账号；退出后回落到本机匿名账号
[ApiController]
[Route("api/auth")]
public sealed class AuthController(UserAuth auth, EmailVerification email) : ControllerBase
{
    [HttpPost("email-code")]
    public async Task<IActionResult> SendEmailCode([FromBody] EmailCodeRequest req, CancellationToken ct) =>
        Ok(await email.SendAsync(req.Email, HttpContext.Connection.RemoteIpAddress?.ToString(), ct));

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] AuthRegisterRequest req, CancellationToken ct) =>
        Ok(await auth.RegisterAsync(req.Email, req.Password, req.DisplayName, req.DeviceId, req.Label,
            req.Code, ct));

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] AuthLoginRequest req, CancellationToken ct) =>
        Ok(await auth.LoginAsync(req.Email, req.Password, req.DeviceId, req.Label, ct));

    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct) =>
        Ok(await auth.LogoutAsync(ApiHelpers.Bearer(Request), ct));

    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct) =>
        Ok(await auth.MeAsync(ApiHelpers.Bearer(Request), ct));
}
