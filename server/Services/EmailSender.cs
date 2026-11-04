using System.Net.Security;
using System.Net.Sockets;
using System.Text;

namespace SpServer.Services;

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

// 验证码邮件发送：不引入第三方包，兼容 465 隐式 TLS 与 587 STARTTLS
public class EmailSender(IConfiguration config, ILogger<EmailSender> logger)
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);
    public EmailOptions Options { get; } = config.GetSection("Email").Get<EmailOptions>() ?? new();

    public bool IsConfigured =>
        Options.Enabled &&
        Options.Host.Trim().Length > 0 &&
        (Options.From.Trim().Length > 0 || Options.User.Contains('@'));

    public bool CanExposeDevCode => !IsConfigured && Options.ExposeDevCode;

    public async Task SendVerificationCodeAsync(string email, string code, CancellationToken ct)
    {
        if (!IsConfigured)
        {
            if (!Options.ExposeDevCode)
            {
                throw new ApiException(503, "email_not_configured", "邮箱验证暂不可用，请联系管理员配置邮件服务");
            }

            logger.LogWarning("未配置 SMTP，邮箱验证码 {Email} => {Code}", email, code);
            return;
        }

        var from = Clean(Options.From.Trim().Length > 0 ? Options.From : Options.User);
        var message = BuildMessage(from, Options.FromName, email, code, Options.CodeMinutes);
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Timeout);
        await SendAsync(Options, from, email, message, cts.Token);
    }

    private async Task SendAsync(EmailOptions options, string from, string to, string message,
        CancellationToken ct)
    {
        await using var session = await SmtpSession.OpenAsync(options.Host.Trim(), options.Port,
            options.UseImplicitTls, ct);

        var greeting = await session.ReadAsync(ct);
        Ensure(greeting, "220", "连接邮件服务器");

        await session.CommandAsync("EHLO sp.local", ct);
        if (!options.UseImplicitTls)
        {
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

    private static void Ensure(string response, string prefix, string action)
    {
        if (!response.StartsWith(prefix, StringComparison.Ordinal))
        {
            throw new IOException($"{action}失败：{response}");
        }
    }

    private static string BuildMessage(string from, string fromName, string to, string code, int minutes)
    {
        var body = $"你的注册验证码是 {code}，{minutes} 分钟内有效。\r\n如非本人操作，请忽略这封邮件。";
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(body));
        var sb = new StringBuilder();
        sb.Append("From: ").Append(EncodeHeader(Clean(fromName))).Append(" <").Append(from).Append(">\r\n");
        sb.Append("To: <").Append(to).Append(">\r\n");
        sb.Append("Subject: ").Append(EncodeHeader("SP 助手注册验证码")).Append("\r\n");
        sb.Append("Date: ").Append(DateTimeOffset.UtcNow.ToString("r")).Append("\r\n");
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

        public async Task<string> ReadAsync(CancellationToken ct)
        {
            var lines = new List<string>();
            while (true)
            {
                var line = await _reader.ReadLineAsync(ct) ?? throw new IOException("邮件服务器已断开连接");
                lines.Add(line);
                if (line.Length < 4 || line[3] != '-') break;
            }
            return lines[^1];
        }

        public async Task<string> CommandAsync(string command, CancellationToken ct)
        {
            await _writer.WriteLineAsync(command.AsMemory(), ct);
            return await ReadAsync(ct);
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
            await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = host }, ct);
            return ssl;
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
