using System.Net.Security;
using SpServer.Domain;
using SpServer.Application;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text;

namespace SpServer.Infrastructure;

public class EmailOptions
{
    public bool Enabled { get; set; }
    public string Host { get; set; } = "";
    public int Port { get; set; } = 465;
    // 465 一般是隐式 TLS，587/25 用 STARTTLS
    public bool UseImplicitTls { get; set; } = true;
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    public string From { get; set; } = "";
    public string FromName { get; set; } = "SP 助手";
    // 未配置 SMTP 时允许在接口响应里返回验证码，仅供本地开发/自动化测试
    public bool ExposeDevCode { get; set; }
    public int CodeMinutes { get; set; } = 10;
}

// 验证码邮件发送：不引入第三方包，兼容 465 隐式 TLS 与 587 STARTTLS。
// SMTP 参数来自后台「服务器配置」，环境变量优先，改完即时生效
public class EmailSender(ServerConfig settings, ILogger<EmailSender> logger)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);

    public static bool IsConfigured(EmailOptions options) =>
        options.Enabled &&
        options.Host.Trim().Length > 0 &&
        (options.From.Trim().Length > 0 || options.User.Contains('@'));

    public bool CanExposeDevCode(EmailOptions options) => !IsConfigured(options) && options.ExposeDevCode;

    public Task<EmailOptions> GetOptionsAsync(CancellationToken ct) => settings.GetEmailOptionsAsync(ct);

    public async Task SendVerificationCodeAsync(string email, string code, EmailOptions options,
        CancellationToken ct)
    {
        if (!IsConfigured(options))
        {
            if (!options.ExposeDevCode)
            {
                throw new ApiException(503, "email_not_configured", "邮箱验证暂不可用，请联系管理员配置邮件服务");
            }

            logger.LogWarning("未配置 SMTP，邮箱验证码 {Email} => {Code}", email, code);
            return;
        }

        var body = $"你的注册验证码是 {code}，{options.CodeMinutes} 分钟内有效。\r\n如非本人操作，请忽略这封邮件。";
        await DeliverAsync(options, email, "SP 助手注册验证码", body, ct);
        logger.LogInformation("注册验证码邮件已提交 SMTP：{Email}", email);
    }

    public async Task SendTestAsync(string to, EmailOptions options, CancellationToken ct)
    {
        if (!IsConfigured(options))
        {
            throw new ApiException(400, "email_not_configured", "请先启用并填写 SMTP 服务器");
        }

        const string body = "这是一封来自 SP 后台的测试邮件，收到说明邮件服务配置可用。";
        await DeliverAsync(options, to, "SP 助手邮件配置测试", body, ct);
    }

    private async Task DeliverAsync(EmailOptions options, string to, string subject, string body,
        CancellationToken ct)
    {
        var from = Clean(options.From.Trim().Length > 0 ? options.From : options.User);
        var message = BuildMessage(from, options.FromName, to, subject, body);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Timeout);
        try
        {
            await SendAsync(options, from, to, message, cts.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // 超时不能冒泡成 OperationCanceledException：上层 catch 会放行取消异常，
            // 最终变成没有任何提示的 HTTP 500，且验证码记录也不会回滚。
            throw new IOException(
                $"连接或发送邮件超时（{Timeout.TotalSeconds:0} 秒）：请确认服务器到 {options.Host}:{options.Port} 的出站连通性，云主机通常封锁 25 端口，建议使用 465 + 隐式 TLS");
        }
    }

    private async Task SendAsync(EmailOptions options, string from, string to, string message,
        CancellationToken ct)
    {
        ValidateTlsMode(options.Port, options.UseImplicitTls);
        if (options.User.Trim().Length > 0 && string.IsNullOrEmpty(options.Password))
        {
            // 后台表单的密码是「只进不出」的，从别的机器/环境导入配置时很容易只填了账号没填授权码；
            // 此时服务器必回 535，提前用中文说清楚，别让用户在收件箱里空等。
            throw new IOException(
                "已填写 SMTP 账号但未保存密码/授权码：请在后台「服务器配置 → 密码 / 授权码」重新填写并保存（留空表示不修改）");
        }

        await using var session = await SmtpSession.OpenAsync(options.Host.Trim(), options.Port,
            options.UseImplicitTls, ct);

        var greeting = await session.ReadAsync(ct);
        Ensure(greeting, "220", "连接邮件服务器");

        var ehlo = await session.CommandLinesAsync("EHLO sp.local", ct);
        if (!options.UseImplicitTls)
        {
            if (!ehlo.Any(line => line.Contains("STARTTLS", StringComparison.OrdinalIgnoreCase)))
            {
                throw new IOException(
                    $"邮件服务器在端口 {options.Port} 上未提供 STARTTLS，请改用 465 端口并开启「隐式 TLS」");
            }

            await session.ExpectAsync("STARTTLS", "220", ct);
            await session.StartTlsAsync(options.Host.Trim(), ct);
            await session.CommandAsync("EHLO sp.local", ct);
        }

        if (!string.IsNullOrEmpty(options.User))
        {
            await session.ExpectAsync("AUTH LOGIN", "334", ct);
            await session.ExpectAsync(Convert.ToBase64String(Encoding.UTF8.GetBytes(options.User)), "334", ct);
            var auth = await session.CommandAsync(
                Convert.ToBase64String(Encoding.UTF8.GetBytes(options.Password)), ct);
            Ensure(auth, "235", "登录邮件服务器");
        }

        await session.ExpectAsync($"MAIL FROM:<{from}>", "250", ct);
        var rcpt = await session.CommandAsync($"RCPT TO:<{to}>", ct);
        Ensure(rcpt, "25", "填写收件人");
        await session.ExpectAsync("DATA", "354", ct);

        await session.WriteAsync(DotStuff(message) + "\r\n.\r\n", ct);
        var accepted = await session.ReadAsync(ct);
        Ensure(accepted, "250", "提交邮件内容");
        try
        {
            await session.CommandAsync("QUIT", ct);
        }
        catch
        {
            // 邮件已投递，QUIT 失败不影响结果
        }
    }

    // 端口与加密方式必须成对：465 = 隐式 TLS，587/25 = 明文 + STARTTLS。
    // 不匹配时 .NET 的 SslStream 会抛 "Cannot determine the frame size or a corrupted frame was received"，
    // 这类底层报错对用户毫无帮助，所以在发起连接前先给出可操作的中文提示。
    public static void ValidateTlsMode(int port, bool implicitTls)
    {
        if (implicitTls && port is 25 or 587)
        {
            throw new IOException(
                $"端口 {port} 是明文 SMTP（STARTTLS），不能启用「隐式 TLS」：请改用 465 端口，或关闭「隐式 TLS」");
        }

        if (!implicitTls && port == 465)
        {
            throw new IOException(
                "端口 465 要求「隐式 TLS」：请开启该开关，或改用 587/25 端口走 STARTTLS");
        }
    }

    private static void Ensure(string response, string prefix, string action)
    {
        if (!response.StartsWith(prefix, StringComparison.Ordinal))
        {
            throw new IOException($"{action}失败：{response}");
        }
    }

    private static string BuildMessage(string from, string fromName, string to, string subject, string body)
    {
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(body));
        var domain = from.Contains('@') ? from[(from.LastIndexOf('@') + 1)..] : "sp.local";
        var sb = new StringBuilder();
        sb.Append("From: ").Append(EncodeHeader(Clean(fromName))).Append(" <").Append(from).Append(">\r\n");
        sb.Append("To: <").Append(to).Append(">\r\n");
        sb.Append("Subject: ").Append(EncodeHeader(subject)).Append("\r\n");
        sb.Append("Date: ").Append(DateTimeOffset.UtcNow.ToString("r")).Append("\r\n");
        // 缺少 Message-ID 的邮件很容易被 Coremail/QQ 等判为垃圾而静默丢弃，
        // 这类「接口 200 但收件箱没有」的问题最难排查，这里补齐常见合规头。
        sb.Append("Message-ID: <").Append(Guid.NewGuid().ToString("N")).Append('@').Append(domain).Append(">\r\n");
        sb.Append("Reply-To: <").Append(from).Append(">\r\n");
        sb.Append("X-Mailer: SP Server SMTP\r\n");
        sb.Append("Auto-Submitted: auto-generated\r\n");
        sb.Append("MIME-Version: 1.0\r\n");
        sb.Append("Content-Type: text/plain; charset=utf-8\r\n");
        sb.Append("Content-Transfer-Encoding: base64\r\n\r\n");
        for (var i = 0; i < encoded.Length; i += 76)
        {
            sb.Append(encoded, i, Math.Min(76, encoded.Length - i)).Append("\r\n");
        }
        return sb.ToString().TrimEnd('\r', '\n');
    }

    private static string EncodeHeader(string text) =>
        $"=?UTF-8?B?{Convert.ToBase64String(Encoding.UTF8.GetBytes(text))}?=";

    private static string Clean(string text) => text.Replace("\r", "").Replace("\n", "");

    private static string DotStuff(string message) =>
        string.Join("\r\n", message.Split("\r\n").Select(line => line.StartsWith('.') ? "." + line : line));

    private sealed class SmtpSession : IAsyncDisposable
    {
        private readonly TcpClient _client;
        private Stream _stream;
        private StreamReader _reader;
        private StreamWriter _writer;

        private SmtpSession(TcpClient client, Stream stream)
        {
            _client = client;
            _stream = stream;
            _reader = new StreamReader(stream, Encoding.UTF8);
            _writer = new StreamWriter(stream, new UTF8Encoding(false)) { NewLine = "\r\n", AutoFlush = true };
        }

        public static async Task<SmtpSession> OpenAsync(string host, int port, bool implicitTls,
            CancellationToken ct)
        {
            var client = new TcpClient();
            try
            {
                await client.ConnectAsync(host, port, ct);
                Stream stream = client.GetStream();
                if (implicitTls)
                {
                    stream = await WrapTlsAsync(stream, host, ct);
                }
                return new SmtpSession(client, stream);
            }
            catch
            {
                client.Dispose();
                throw;
            }
        }

        public async Task<string[]> ReadLinesAsync(CancellationToken ct)
        {
            var lines = new List<string>();
            while (true)
            {
                var line = await _reader.ReadLineAsync(ct) ?? throw new IOException("邮件服务器已断开连接");
                lines.Add(line);
                if (line.Length < 4 || line[3] != '-') break;
            }
            return lines.ToArray();
        }

        public async Task<string> ReadAsync(CancellationToken ct) => (await ReadLinesAsync(ct))[^1];

        public async Task<string> CommandAsync(string command, CancellationToken ct)
        {
            await _writer.WriteLineAsync(command.AsMemory(), ct);
            return await ReadAsync(ct);
        }

        public async Task<string[]> CommandLinesAsync(string command, CancellationToken ct)
        {
            await _writer.WriteLineAsync(command.AsMemory(), ct);
            return await ReadLinesAsync(ct);
        }

        public Task WriteAsync(string text, CancellationToken ct) => _writer.WriteAsync(text.AsMemory(), ct);

        public async Task ExpectAsync(string command, string prefix, CancellationToken ct)
        {
            var response = await CommandAsync(command, ct);
            if (!response.StartsWith(prefix, StringComparison.Ordinal))
            {
                throw new IOException($"SMTP 命令被拒绝：{response}");
            }
        }

        public async Task StartTlsAsync(string host, CancellationToken ct)
        {
            await _writer.FlushAsync(ct);
            _stream = await WrapTlsAsync(_stream, host, ct);
            _reader = new StreamReader(_stream, Encoding.UTF8);
            _writer = new StreamWriter(_stream, new UTF8Encoding(false)) { NewLine = "\r\n", AutoFlush = true };
        }

        private static async Task<Stream> WrapTlsAsync(Stream stream, string host, CancellationToken ct)
        {
            var ssl = new SslStream(stream, false);
            try
            {
                await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = host }, ct);
                return ssl;
            }
            catch (Exception ex) when (ex is IOException or AuthenticationException)
            {
                // 最常见的原因是拿 TLS 去连明文端口（服务器先发 220 欢迎语），
                // 或拿明文去连 465；也可能是代理/防火墙把流量改写了。
                throw new IOException(
                    $"TLS 握手失败（{ex.Message}）：请确认端口与加密方式匹配——465 开启「隐式 TLS」，587/25 关闭后走 STARTTLS；也请检查是否被代理或防火墙拦截",
                    ex);
            }
        }

        public async ValueTask DisposeAsync()
        {
            try
            {
                await _writer.DisposeAsync();
            }
            catch
            {
                // 连接已断开时忽略
            }
            _stream.Dispose();
            _client.Dispose();
        }
    }
}
