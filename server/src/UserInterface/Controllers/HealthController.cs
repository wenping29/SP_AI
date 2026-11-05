using Microsoft.AspNetCore.Mvc;

namespace SpServer.UserInterface.Controllers;

[ApiController]
public sealed class HealthController : ControllerBase
{
    [HttpGet("/health")]
    public IActionResult Get() => Ok(new { ok = true, time = DateTime.UtcNow });
}
