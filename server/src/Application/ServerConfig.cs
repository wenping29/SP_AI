using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using SpServer.Contracts;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Application;

public record EmailSettingsView(
    bool Enabled,
    string Host,
    int Port,
    bool ImplicitTls,
    string User,
    bool PasswordSet,
    string PasswordSource,
    string From,
    string FromName,
    int CodeMinutes,
    bool ExposeDevCode,
    bool Configured,
    string Source,
    string? Warning);

// 服务器运行配置：SMTP 与允许来源。环境变量优先，其次是后台保存到数据库的值
public class ServerConfig(AppDbContext db, IConfiguration config, IDataProtectionProvider protection,
    ILogger<ServerConfig> logger)
{
    private const string Purpose = "SpServer.SmtpPassword.v1";

    public async Task<ServerSetting> GetRowAsync(CancellationToken ct) =>
        await db.ServerSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Id == 1, ct)
        ?? new ServerSetting();

    public async Task<EmailOptions> GetEmailOptionsAsync(CancellationToken ct)
    {
        var row = await GetRowAsync(ct);
        return new EmailOptions
        {
            Enabled = EnvBool("Email__Enabled") ?? row.SmtpEnabled,
            Host = EnvText("Email__Host") ?? row.SmtpHost,
            Port = EnvInt("Email__Port") ?? row.SmtpPort,
            UseImplicitTls = EnvBool("Email__UseImplicitTls") ?? row.SmtpImplicitTls,
            User = EnvText("Email__User") ?? row.SmtpUser,
            Password = EnvText("Email__Password") ?? Unprotect(row.SmtpPasswordCipher),
            From = EnvText("Email__From") ?? row.SmtpFrom,
            FromName = EnvText("Email__FromName") ?? row.SmtpFromName,
            ExposeDevCode = EnvBool("Email__ExposeDevCode") ?? row.ExposeDevCode,
            CodeMinutes = EnvInt("Email__CodeMinutes") ?? row.CodeMinutes,
        };
    }

    public async Task<EmailSettingsView> GetEmailViewAsync(CancellationToken ct)
    {
        var options = await GetEmailOptionsAsync(ct);
        var row = await GetRowAsync(ct);
        var envPassword = !string.IsNullOrWhiteSpace(EnvText("Email__Password"));
        var passwordSource = envPassword
            ? "env"
            : string.IsNullOrWhiteSpace(row.SmtpPasswordCipher) ? "none" : "database";

        return new EmailSettingsView(
            options.Enabled,
            options.Host,
            options.Port,
            options.UseImplicitTls,
            options.User,
            !string.IsNullOrWhiteSpace(options.Password),
            passwordSource,
            options.From,
            options.FromName,
            options.CodeMinutes,
            options.ExposeDevCode,
            EmailSender.IsConfigured(options),
            EmailEnvOverridden() ? "env" : "database",
            BuildEmailWarning(options));
    }

    // 「已配置」只校验启用/主机/发件人，填了账号却没存授权码时仍会显示绿色标签，
    // 但 SMTP 必回 535。把这种情况单独提示出来，省得对着收件箱空等。
    private static string? BuildEmailWarning(EmailOptions options)
    {
        if (!options.Enabled) return null;
        return options.User.Trim().Length > 0 && string.IsNullOrEmpty(options.Password)
            ? "已填写 SMTP 账号但未保存密码/授权码，邮件服务器会拒绝登录；请在「密码 / 授权码」里重新填写并保存"
            : null;
    }

    public async Task<(string[] Origins, string Source)> GetAllowedOriginsAsync(CancellationToken ct)
    {
        var configured = config.GetSection("AllowedOrigins").Get<string[]>();
        if (configured is { Length: > 0 }) return (NormalizeOrigins(configured), "config");

        var row = await GetRowAsync(ct);
        var origins = NormalizeOrigins(SplitOrigins(row.AllowedOrigins));
        return (origins, origins.Length > 0 ? "database" : "none");
    }

    public async Task SaveAsync(ServerSettingsRequest req, CancellationToken ct)
    {
        var row = await db.ServerSettings.FirstOrDefaultAsync(s => s.Id == 1, ct);
        if (row is null)
        {
            row = new ServerSetting { Id = 1 };
            db.ServerSettings.Add(row);
        }

        if (req.SmtpEnabled is { } enabled) row.SmtpEnabled = enabled;
        if (req.SmtpHost is not null) row.SmtpHost = req.SmtpHost.Trim();
        if (req.SmtpPort is { } port)
        {
            if (port is < 1 or > 65535) throw new ApiException(400, "invalid_port", "端口需在 1-65535 之间");
            row.SmtpPort = port;
        }

        if (req.SmtpImplicitTls is { } implicitTls) row.SmtpImplicitTls = implicitTls;
        if (req.SmtpUser is not null) row.SmtpUser = req.SmtpUser.Trim();
        if (req.SmtpFrom is not null) row.SmtpFrom = req.SmtpFrom.Trim();
        if (req.SmtpFromName is not null) row.SmtpFromName = req.SmtpFromName.Trim();
        if (req.CodeMinutes is { } minutes)
        {
            if (minutes is < 1 or > 30) throw new ApiException(400, "invalid_minutes", "验证码有效期需在 1-30 分钟之间");
            row.CodeMinutes = minutes;
        }

        if (req.ExposeDevCode is { } expose) row.ExposeDevCode = expose;

        // 密码只进不出：留空表示不修改，要清空必须显式传 clearSmtpPassword
        if (req.ClearSmtpPassword == true)
        {
            row.SmtpPasswordCipher = "";
        }
        else if (!string.IsNullOrWhiteSpace(req.SmtpPassword))
        {
            row.SmtpPasswordCipher = protection.CreateProtector(Purpose).Protect(req.SmtpPassword.Trim());
        }

        if (req.AllowedOrigins is not null)
        {
            row.AllowedOrigins = string.Join('\n', NormalizeOrigins(req.AllowedOrigins));
        }

        if (row.SmtpEnabled)
        {
            if (row.SmtpHost.Length == 0)
                throw new ApiException(400, "smtp_host_required", "启用邮件服务时必须填写 SMTP 服务器");
            var from = row.SmtpFrom.Length > 0 ? row.SmtpFrom : row.SmtpUser;
            if (!from.Contains('@'))
                throw new ApiException(400, "smtp_from_required", "发件人需填写邮箱地址（或填写带 @ 的用户名）");

            // 465/隐式 TLS、587/25/STARTTLS 必须成对，保存时就拦下，别等发信时报底层 TLS 错误
            try
            {
                EmailSender.ValidateTlsMode(row.SmtpPort, row.SmtpImplicitTls);
            }
            catch (IOException ex)
            {
                throw new ApiException(400, "smtp_tls_mismatch", ex.Message);
            }
        }

        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        logger.LogInformation("服务器配置已更新（SMTP {State}）", row.SmtpEnabled ? "启用" : "关闭");
    }

    private string Unprotect(string cipher)
    {
        if (string.IsNullOrWhiteSpace(cipher)) return "";
        try
        {
            return protection.CreateProtector(Purpose).Unprotect(cipher);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "SMTP 密码解密失败，需重新填写");
            return "";
        }
    }

    private static string? EnvText(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static bool? EnvBool(string name) =>
        EnvText(name) is { } text && bool.TryParse(text, out var value) ? value : null;

    private static int? EnvInt(string name) =>
        EnvText(name) is { } text && int.TryParse(text, out var value) ? value : null;

    private static bool EmailEnvOverridden() =>
        new[] { "Email__Enabled", "Email__Host", "Email__Port", "Email__User", "Email__From" }
            .Any(name => EnvText(name) is not null);

    private static IEnumerable<string> SplitOrigins(string text) =>
        text.Split(['\n', '\r', ',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static string[] NormalizeOrigins(IEnumerable<string> origins) =>
        origins
            .Select(origin => origin.Trim().TrimEnd('/'))
            .Where(origin => origin.Length > 0 && origin != "*")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
}
