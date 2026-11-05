using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.UserInterface.Filters;
using SpServer.Application;
using SpServer.Infrastructure;

namespace SpServer.UserInterface.Controllers;

// 服务器配置：邮件服务与允许来源，保存后立即生效（SMTP 环境变量仍然优先）
[ApiController]
[Route("api/admin")]
public sealed class ServerConfigController(ServerConfig settings, EmailSender sender, IConfiguration cfg,
    IHostEnvironment env, ServerRuntime runtime) : ControllerBase
{
    [HttpGet("server")]
    [AdminPermission("server.view")]
    public async Task<IActionResult> Get(CancellationToken ct) => Ok(await BuildServerViewAsync(ct));

    [HttpPut("server")]
    [AdminPermission("server.manage")]
    public async Task<IActionResult> Update([FromBody] ServerSettingsRequest req, CancellationToken ct)
    {
        await settings.SaveAsync(req, ct);
        return Ok(await BuildServerViewAsync(ct));
    }

    [HttpPost("server/test-email")]
    [AdminPermission("server.manage")]
    public async Task<IActionResult> TestEmail([FromBody] TestEmailRequest req, CancellationToken ct)
    {
        var to = (req.To ?? "").Trim();
        if (to.Length is 0 or > 120 || !to.Contains('@'))
            throw new ApiException(400, "invalid_email", "请输入有效的收件邮箱");

        var options = await sender.GetOptionsAsync(ct);
        if (!EmailSender.IsConfigured(options))
            throw new ApiException(400, "email_not_configured", "请先启用并填写 SMTP 服务器");

        try
        {
            await sender.SendTestAsync(to, options, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new ApiException(502, "email_send_failed", $"测试邮件发送失败：{ex.Message}");
        }

        return Ok(new { ok = true, to });
    }

    // 运行信息从进程配置里读，邮件与来源来自数据库（环境变量优先）
    private async Task<object> BuildServerViewAsync(CancellationToken ct)
    {
        var email = await settings.GetEmailViewAsync(ct);
        var (origins, originsSource) = await settings.GetAllowedOriginsAsync(ct);

        var dataSource = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(
            cfg.GetConnectionString("Db") ?? "Data Source=sp.db").DataSource;
        var databaseFile = Path.IsPathRooted(dataSource)
            ? dataSource
            : Path.GetFullPath(dataSource, env.ContentRootPath);

        var keysPath = cfg["Security:KeysPath"] is { Length: > 0 } custom ? custom : "keys";
        if (!Path.IsPathRooted(keysPath)) keysPath = Path.GetFullPath(Path.Combine(env.ContentRootPath, keysPath));

        var urls = cfg["urls"] is { Length: > 0 } explicitUrls
            ? explicitUrls
            : $"http://{cfg["Server:Host"] ?? "127.0.0.1"}:{cfg.GetValue("Server:Port", 5080)}";

        return new
        {
            email,
            allowedOrigins = origins,
            allowedOriginsSource = originsSource,
            runtime = new
            {
                environment = env.EnvironmentName,
                version = typeof(ServerConfig).Assembly.GetName().Version?.ToString() ?? "",
                framework = Environment.Version.ToString(),
                urls,
                databaseFile,
                keysPath,
                startedAt = runtime.StartedAt.UtcDateTime,
                uptimeSeconds = (long)(DateTimeOffset.UtcNow - runtime.StartedAt).TotalSeconds,
            },
        };
    }
}
