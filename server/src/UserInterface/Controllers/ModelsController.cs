using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SpServer.Contracts;
using SpServer.Infrastructure;
using SpServer.Domain;
using SpServer.UserInterface.Filters;

namespace SpServer.UserInterface.Controllers;

// 模型管理：费率、上下文、视觉能力、分类与上下线
[ApiController]
[Route("api/admin")]
public sealed class ModelsController(AppDbContext db, ProviderKey keys) : ControllerBase
{
    [HttpGet("models")]
    [AdminPermission("models.view")]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await db.Models
            .OrderBy(m => m.IsDeprecated)
            .ThenBy(m => m.SortOrder)
            .ThenBy(m => m.Id)
            .ToListAsync(ct));

    // 新增模型时给下拉框用，避免依赖 KeyEnv 查看权限
    [HttpGet("model-providers")]
    [AdminPermission("models.view")]
    public IActionResult Providers() =>
        Ok(keys.Providers().Select(p => new { p.Provider, p.BaseUrl }));

    [HttpPost("models")]
    [AdminPermission("models.manage")]
    public async Task<IActionResult> Create([FromBody] ModelCreateRequest req, CancellationToken ct)
    {
        var modelId = ApiHelpers.NormalizeModelId(req.ModelId);
        if (await db.Models.AnyAsync(m => m.ModelId.ToLower() == modelId.ToLower(), ct))
        {
            throw new ApiException(409, "model_id_exists", $"模型 ID {modelId} 已存在");
        }

        var model = new ModelSpec
        {
            ModelId = modelId,
            DisplayName = ApiHelpers.RequireText(req.DisplayName, "显示名称", 60),
            Provider = keys.CanonicalProvider(req.Provider ?? ""),
            UpstreamModel = ApiHelpers.RequireText(req.UpstreamModel, "上游模型名", 128),
            InputRatePer1K = Math.Clamp(req.InputRatePer1K ?? 0, 0, 100000),
            OutputRatePer1K = Math.Clamp(req.OutputRatePer1K ?? 0, 0, 100000),
            MaxContextChars = Math.Clamp(req.MaxContextChars ?? 12000, 1000, 200000),
            SupportsVision = req.SupportsVision ?? false,
            IsEnabled = req.IsEnabled ?? true,
            SortOrder = req.SortOrder ?? (await db.Models.MaxAsync(m => (int?)m.SortOrder, ct) ?? 0) + 1,
            Category = ApiHelpers.ClampText(req.Category, 20),
            Note = ApiHelpers.ClampText(req.Note, 200),
        };

        db.Models.Add(model);
        await db.SaveChangesAsync(ct);
        return Ok(model);
    }

    [HttpPut("models/{modelId}")]
    [AdminPermission("models.manage")]
    public async Task<IActionResult> Update(string modelId, [FromBody] ModelRequest req, CancellationToken ct)
    {
        var model = await db.Models.FirstOrDefaultAsync(m => m.ModelId == modelId, ct)
            ?? throw new ApiException(404, "model_not_found", "模型不存在");

        if (req.DisplayName is not null) model.DisplayName = ApiHelpers.RequireText(req.DisplayName, "显示名称", 60);
        if (req.Provider is not null) model.Provider = keys.CanonicalProvider(req.Provider);
        if (req.UpstreamModel is not null) model.UpstreamModel = ApiHelpers.RequireText(req.UpstreamModel, "上游模型名", 128);

        if (req.IsEnabled is { } enabled)
        {
            if (enabled && model.IsDeprecated)
            {
                throw new ApiException(409, "deprecated_model", "模型已废弃，请先恢复再启用");
            }

            model.IsEnabled = enabled;
        }

        if (req.InputRatePer1K is { } inputRate) model.InputRatePer1K = Math.Clamp(inputRate, 0, 100000);
        if (req.OutputRatePer1K is { } outputRate) model.OutputRatePer1K = Math.Clamp(outputRate, 0, 100000);
        if (req.MaxContextChars is { } maxChars) model.MaxContextChars = Math.Clamp(maxChars, 1000, 200000);
        if (req.SortOrder is { } sort) model.SortOrder = Math.Clamp(sort, 0, 9999);
        if (req.SupportsVision is { } vision) model.SupportsVision = vision;
        if (req.Category is not null) model.Category = ApiHelpers.ClampText(req.Category, 20);
        if (req.Note is not null) model.Note = ApiHelpers.ClampText(req.Note, 200);

        await db.SaveChangesAsync(ct);
        return Ok(model);
    }

    [HttpPost("models/{modelId}/deprecate")]
    [AdminPermission("models.manage")]
    public async Task<IActionResult> Deprecate(string modelId, [FromBody] DeprecateRequest req,
        CancellationToken ct)
    {
        if (req.Deprecated is null) throw new ApiException(400, "invalid_deprecated", "缺少废弃状态");

        var model = await db.Models.FirstOrDefaultAsync(m => m.ModelId == modelId, ct)
            ?? throw new ApiException(404, "model_not_found", "模型不存在");

        model.IsDeprecated = req.Deprecated.Value;
        // 废弃即下线；恢复后保持停用，由管理员确认后再启用
        if (model.IsDeprecated) model.IsEnabled = false;

        await db.SaveChangesAsync(ct);
        return Ok(model);
    }

    [HttpDelete("models/{modelId}")]
    [AdminPermission("models.manage")]
    public async Task<IActionResult> Delete(string modelId, CancellationToken ct)
    {
        var model = await db.Models.FirstOrDefaultAsync(m => m.ModelId == modelId, ct)
            ?? throw new ApiException(404, "model_not_found", "模型不存在");

        // 调用记录按模型 ID 保存，直接删会丢失名称映射；有历史的模型只能废弃
        if (await db.Transactions.AnyAsync(t => t.ModelId == model.ModelId, ct))
        {
            throw new ApiException(409, "model_in_use", "该模型已有调用记录，请改为废弃以保留历史");
        }

        db.Models.Remove(model);
        await db.SaveChangesAsync(ct);
        return Ok(new { modelId, deleted = true });
    }
}
