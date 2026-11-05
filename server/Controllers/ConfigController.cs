using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SpServer.Data;
using SpServer.Services;

namespace SpServer.Controllers;

// 插件端运行配置：模型、费率、公告、语音开关，随时读最新的后台设置
[ApiController]
[Route("api")]
public sealed class ConfigController(AppDbContext db, CreditService credits, ProviderKey keys,
    IConfiguration config) : ControllerBase
{
    [HttpGet("config")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        var policy = await credits.GetPolicyAsync(ct);
        // 没有任何启用 KeyEnv 的提供商，其模型不下发，避免用户选中后才报错
        var usable = await keys.UsableProvidersAsync(ct);
        var models = await db.Models.Where(m => m.IsEnabled && !m.IsDeprecated && usable.Contains(m.Provider))
            .OrderBy(m => m.SortOrder).ToListAsync(ct);

        return Ok(new
        {
            chatEnabled = policy.ChatEnabled,
            freeCredits = policy.FreeCredits,
            notice = policy.Notice,
            maxOutputTokens = config.GetValue("MaxOutputTokens", 1024),
            voice = new
            {
                enabled = config.GetValue("Transcribe:Enabled", true),
                creditsPerCall = config.GetValue("Transcribe:CreditsPerCall", 3),
            },
            models = models.Select(m => new
            {
                m.ModelId,
                m.DisplayName,
                m.Provider,
                inputRatePer1K = m.InputRatePer1K,
                outputRatePer1K = m.OutputRatePer1K,
                maxContextChars = m.MaxContextChars,
                supportsVision = m.SupportsVision,
                m.Category,
                m.Note,
            }),
            actions = PromptTemplates.Actions,
        });
    }
}
