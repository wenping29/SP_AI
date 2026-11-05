using Microsoft.AspNetCore.Mvc;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.UserInterface.Filters;
using SpServer.Infrastructure;

namespace SpServer.UserInterface.Controllers;

// 上游密钥：KeyEnv 多条目轮换 + 旧的单密钥兼容入口
[ApiController]
[Route("api/admin")]
public sealed class KeyEnvsController(ProviderKey keys) : ControllerBase
{
    [HttpGet("providers")]
    [AdminPermission("keyenvs.view")]
    public async Task<IActionResult> ListProviders(CancellationToken ct) =>
        Ok(await keys.ListProvidersAsync(ct));

    [HttpGet("keyenvs")]
    [AdminPermission("keyenvs.view")]
    public async Task<IActionResult> List([FromQuery] string? provider,
        [FromQuery] bool? includeDeprecated, CancellationToken ct) =>
        Ok(await keys.ListEntriesAsync(provider, includeDeprecated ?? false, ct));

    [HttpPost("keyenvs")]
    [AdminPermission("keyenvs.manage")]
    public async Task<IActionResult> Create([FromBody] KeyEnvCreateRequest req, CancellationToken ct) =>
        Ok(await keys.CreateAsync(req.Provider ?? "", req.EnvName, req.Key, req.Note,
            req.Activate ?? false, ct));

    [HttpPut("keyenvs/{id:int}")]
    [AdminPermission("keyenvs.manage")]
    public async Task<IActionResult> Update(int id, [FromBody] KeyEnvUpdateRequest req, CancellationToken ct) =>
        Ok(await keys.UpdateAsync(id, req.EnvName, req.Key, req.ClearKey ?? false, req.Note, ct));

    [HttpDelete("keyenvs/{id:int}")]
    [AdminPermission("keyenvs.manage")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await keys.DeleteAsync(id, ct);
        return Ok(new { id, deleted = true });
    }

    [HttpPost("keyenvs/{id:int}/activate")]
    [AdminPermission("keyenvs.manage")]
    public async Task<IActionResult> Activate(int id, CancellationToken ct) =>
        Ok(await keys.ActivateAsync(id, ct));

    [HttpPost("keyenvs/{id:int}/deprecate")]
    [AdminPermission("keyenvs.manage")]
    public async Task<IActionResult> SetDeprecated(int id, [FromBody] DeprecateRequest req,
        CancellationToken ct)
    {
        if (req.Deprecated is null) throw new ApiException(400, "invalid_deprecate", "缺少废弃状态");
        return Ok(await keys.SetDeprecatedAsync(id, req.Deprecated.Value, ct));
    }

    [HttpPut("providers/{provider}/key")]
    [AdminPermission("keyenvs.manage")]
    public async Task<IActionResult> SaveLegacyKey(string provider, [FromBody] ProviderKeyRequest req,
        CancellationToken ct) =>
        Ok(await keys.SaveAsync(provider, req.Key, ct));
}
