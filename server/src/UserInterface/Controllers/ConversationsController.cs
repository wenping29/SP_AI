using Microsoft.AspNetCore.Mvc;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 聊天记录同步：仅登录账号可用，匿名设备继续只存本地
[ApiController]
[Route("api/conversations")]
public sealed class ConversationsController(UserAuth auth, ConversationStore store) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await store.ListAsync(await ApiHelpers.RequireMemberIdAsync(HttpContext, auth, ct), ct));

    [HttpGet("{clientId}")]
    public async Task<IActionResult> Get(string clientId, CancellationToken ct) =>
        Ok(await store.GetAsync(await ApiHelpers.RequireMemberIdAsync(HttpContext, auth, ct), clientId, ct));

    [HttpPut("{clientId}")]
    public async Task<IActionResult> Upsert(string clientId, [FromBody] ConversationUpsertRequest req,
        CancellationToken ct) =>
        Ok(await store.UpsertAsync(await ApiHelpers.RequireMemberIdAsync(HttpContext, auth, ct), clientId,
            req.Title, req.Messages, req.UpdatedAt, ct));

    [HttpDelete("{clientId}")]
    public async Task<IActionResult> Delete(string clientId, CancellationToken ct)
    {
        var deleted = await store.DeleteAsync(await ApiHelpers.RequireMemberIdAsync(HttpContext, auth, ct),
            clientId, ct);
        return Ok(new { clientId, deleted });
    }
}
