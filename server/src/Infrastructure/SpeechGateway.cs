using System.Net.Http.Headers;
using SpServer.Domain;
using System.Text;
using System.Text.Json;

namespace SpServer.Infrastructure;

/// 语音转文字：走 OpenAI 兼容的 /audio/transcriptions，国内几家（百炼、硅基流动等）都是这个形状
public class SpeechGateway(IHttpClientFactory httpFactory, IConfiguration config, ProviderKey providerKeys,
    ILogger<SpeechGateway> logger)
{
    public async Task<string> TranscribeAsync(Stream audio, string fileName, string mimeType, CancellationToken ct)
    {
        var provider = config["Transcribe:Provider"] ?? "dashscope";
        var model = config["Transcribe:Model"] ?? "qwen3-asr-flash";

        var key = await providerKeys.ResolveAsync(provider, ct);
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new ApiException(503, "asr_not_configured", "语音输入暂未开放，管理员需先为识别服务配置密钥");
        }

        var baseUrl = config[$"Providers:{provider}:BaseUrl"]
            ?? throw new ApiException(500, "no_base_url", $"未配置 {provider} 的 BaseUrl");

        using var form = new MultipartFormDataContent();
        var fileContent = new StreamContent(audio);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(SafeMime(mimeType));
        form.Add(fileContent, "file", string.IsNullOrWhiteSpace(fileName) ? "voice.webm" : fileName);
        form.Add(new StringContent(model), "model");

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl.TrimEnd('/')}/audio/transcriptions")
        {
            Content = form,
        };
        request.Headers.Authorization = new("Bearer", key);

        var client = httpFactory.CreateClient("upstream");
        using var response = await client.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
        {
            var status = (int)response.StatusCode;
            logger.LogWarning("语音识别 {Provider}/{Model} 返回 {Status}: {Body}",
                provider, model, status, Truncate(body, 500));
            // 上游报文只进日志，不回显给客户端，避免泄露密钥片段
            throw new ApiException(502, "asr_error", status switch
            {
                401 or 403 => "识别服务鉴权失败，请管理员检查密钥配置",
                429 => "识别服务当前限流，请稍后重试",
                _ => $"识别服务暂时不可用（{status}），请稍后重试",
            });
        }

        JsonDocument parsed;
        try
        {
            parsed = JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            throw new ApiException(502, "bad_asr_response", "识别服务返回的内容无法解析，请稍后重试");
        }

        using (parsed)
        {
            return parsed.RootElement.TryGetProperty("text", out var text) ? text.GetString() ?? "" : "";
        }
    }

    // 浏览器偶尔给带 codecs 的复合 MIME，multipart 的 content-type 只接受 type/sub
    private static string SafeMime(string? mimeType) =>
        string.IsNullOrWhiteSpace(mimeType) || !mimeType.Contains('/') ? "application/octet-stream" : mimeType.Split(';')[0].Trim();

    private static string Truncate(string text, int max) =>
        text.Length <= max ? text : text[..max] + "…";
}
