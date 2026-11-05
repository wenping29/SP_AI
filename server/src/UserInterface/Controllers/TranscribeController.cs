using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Application;
using SpServer.Infrastructure;

namespace SpServer.UserInterface.Controllers;

// 语音输入：录音上传转写，按次扣分；识别失败不扣分，积分不足直接拒
[ApiController]
[Route("api")]
public sealed class TranscribeController(CreditService credits, SpeechGateway speech,
    IConfiguration config) : ControllerBase
{
    [HttpPost("transcribe")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Transcribe([FromForm] TranscribeRequest req, CancellationToken ct)
    {
        var file = req.File;
        if (!config.GetValue("Transcribe:Enabled", true))
        {
            throw new ApiException(503, "transcribe_disabled", "语音输入当前已关闭");
        }

        var account = await credits.AuthenticateAsync(ApiHelpers.Bearer(Request), ct);
        var cost = Math.Max(0, config.GetValue("Transcribe:CreditsPerCall", 3));
        if (account.Balance < cost)
        {
            throw new ApiException(402, "insufficient_credits", $"语音输入需要 {cost} 积分，当前余额 {account.Balance}");
        }

        if (file is null || file.Length == 0) throw new ApiException(400, "no_audio", "没有收到录音");

        // 一分钟中文录音压得动，超过这个体积基本是忘点停止
        const long MaxAudioBytes = 8 * 1024 * 1024;
        if (file.Length > MaxAudioBytes) throw new ApiException(413, "audio_too_large", "录音太长，请重新录制");

        string text;
        await using (var stream = file.OpenReadStream())
        {
            text = await speech.TranscribeAsync(stream, file.FileName, file.ContentType, ct);
        }

        var trimmed = (text ?? "").Trim();
        if (trimmed.Length == 0) throw new ApiException(502, "empty_transcription", "没有听清内容，请靠近麦克风再说一次");

        var balance = await credits.ChargeFixedAsync(account, cost, "voice",
            config["Transcribe:Model"] ?? "qwen3-asr-flash", ct);

        return Ok(new { text = trimmed, cost, balance });
    }
}
