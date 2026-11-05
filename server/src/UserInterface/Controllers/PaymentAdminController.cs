using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SpServer.Application;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Infrastructure;
using SpServer.UserInterface.Filters;

namespace SpServer.UserInterface.Controllers;

// 后台充值管理：套餐、订单与支付渠道配置
[ApiController]
[Route("api/admin/payment")]
public sealed class PaymentAdminController(AppDbContext db, PaymentService payments) : ControllerBase
{
    [HttpGet("packages")]
    [AdminPermission("policy.view")]
    public async Task<IActionResult> Packages(CancellationToken ct)
    {
        var rows = await db.CreditPackages.AsNoTracking()
            .OrderBy(p => p.SortOrder).ThenBy(p => p.Id)
            .ToListAsync(ct);
        var used = await db.PaymentOrders.AsNoTracking()
            .GroupBy(o => o.PackageId)
            .Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);

        return Ok(rows.Select(p => new
        {
            p.Id, p.Name, p.PriceCents, p.Credits, p.Note, p.SortOrder, p.IsEnabled,
            orderCount = used.GetValueOrDefault(p.Id),
            updatedAt = ApiHelpers.AsUtc(p.UpdatedAt),
        }));
    }

    [HttpPost("packages")]
    [AdminPermission("policy.manage")]
    public async Task<IActionResult> CreatePackage([FromBody] PackageRequest req, CancellationToken ct)
    {
        var package = new CreditPackage
        {
            Name = (req.Name ?? "").Trim(),
            PriceCents = req.PriceCents ?? 0,
            Credits = req.Credits ?? 0,
            Note = (req.Note ?? "").Trim(),
            SortOrder = req.SortOrder ?? 0,
            IsEnabled = req.IsEnabled ?? true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        ValidatePackage(package);

        db.CreditPackages.Add(package);
        await db.SaveChangesAsync(ct);
        return Ok(new { package.Id });
    }

    [HttpPut("packages/{id:int}")]
    [AdminPermission("policy.manage")]
    public async Task<IActionResult> UpdatePackage(int id, [FromBody] PackageRequest req, CancellationToken ct)
    {
        var package = await db.CreditPackages.FirstOrDefaultAsync(p => p.Id == id, ct)
            ?? throw new ApiException(404, "package_not_found", "套餐不存在");

        if (req.Name is not null) package.Name = req.Name.Trim();
        if (req.PriceCents is { } price) package.PriceCents = price;
        if (req.Credits is { } credits) package.Credits = credits;
        if (req.Note is not null) package.Note = req.Note.Trim();
        if (req.SortOrder is { } sortOrder) package.SortOrder = sortOrder;
        if (req.IsEnabled is { } enabled) package.IsEnabled = enabled;
        package.UpdatedAt = DateTime.UtcNow;

        ValidatePackage(package);
        await db.SaveChangesAsync(ct);
        return Ok(new { package.Id });
    }

    [HttpDelete("packages/{id:int}")]
    [AdminPermission("policy.manage")]
    public async Task<IActionResult> DeletePackage(int id, CancellationToken ct)
    {
        var package = await db.CreditPackages.FirstOrDefaultAsync(p => p.Id == id, ct)
            ?? throw new ApiException(404, "package_not_found", "套餐不存在");

        if (await db.PaymentOrders.AnyAsync(o => o.PackageId == id, ct))
        {
            throw new ApiException(400, "package_in_use", "该套餐已有充值订单，请改为下架而不是删除");
        }

        db.CreditPackages.Remove(package);
        await db.SaveChangesAsync(ct);
        return Ok(new { deleted = true });
    }

    [HttpGet("orders")]
    [AdminPermission("policy.view")]
    public async Task<IActionResult> Orders(
        [FromQuery] string? q, [FromQuery] string? status,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var query = db.PaymentOrders.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(status))
        {
            var value = status.Trim().ToLowerInvariant();
            if (value is not ("pending" or "paid" or "closed")) value = "";
            if (value.Length > 0) query = query.Where(o => o.Status == value);
        }

        var keyword = (q ?? "").Trim();
        if (keyword.Length > 0)
        {
            var userIds = await db.Users.AsNoTracking()
                .Where(u => u.Email.Contains(keyword) || u.DisplayName.Contains(keyword))
                .Select(u => u.Id)
                .ToListAsync(ct);
            query = query.Where(o => o.OrderNo.Contains(keyword)
                || o.ExternalOrderNo.Contains(keyword)
                || o.PackageName.Contains(keyword)
                || userIds.Contains(o.UserId));
        }

        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(o => o.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .ToListAsync(ct);

        var ids = rows.Select(o => o.UserId).Distinct().ToList();
        var users = await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .Select(u => new { u.Id, u.Email, u.DisplayName })
            .ToDictionaryAsync(u => u.Id, ct);

        return Ok(new
        {
            total, page, pageSize,
            items = rows.Select(o =>
            {
                users.TryGetValue(o.UserId, out var user);
                return new
                {
                    o.OrderNo,
                    o.UserId,
                    email = user?.Email ?? "",
                    displayName = user?.DisplayName ?? "",
                    o.PackageName,
                    o.PriceCents,
                    o.Credits,
                    o.Channel,
                    o.Provider,
                    o.Status,
                    o.ExternalOrderNo,
                    createdAt = ApiHelpers.AsUtc(o.CreatedAt),
                    expiresAt = ApiHelpers.AsUtc(o.ExpiresAt),
                    paidAt = o.PaidAt is { } paid ? ApiHelpers.AsUtc(paid) : (DateTime?)null,
                };
            }),
        });
    }

    [HttpPost("orders/{orderNo}/close")]
    [AdminPermission("policy.manage")]
    public async Task<IActionResult> CloseOrder(string orderNo, CancellationToken ct)
    {
        var affected = await db.PaymentOrders
            .Where(o => o.OrderNo == orderNo && o.Status == PaymentService.StatusPending)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, PaymentService.StatusClosed), ct);
        if (affected == 0) throw new ApiException(400, "order_not_pending", "订单不存在或已不在待支付状态");
        return Ok(new { orderNo, status = PaymentService.StatusClosed });
    }

    [HttpGet("settings")]
    [AdminPermission("policy.view")]
    public async Task<IActionResult> Settings(CancellationToken ct) =>
        Ok(await payments.GetSettingsViewAsync(ct));

    [HttpPut("settings")]
    [AdminPermission("policy.manage")]
    public async Task<IActionResult> UpdateSettings([FromBody] PaymentSettingsRequest req, CancellationToken ct)
    {
        await payments.SaveSettingsAsync(req, ct);
        return Ok(await payments.GetSettingsViewAsync(ct));
    }

    private static void ValidatePackage(CreditPackage package)
    {
        if (package.Name.Length is 0 or > 30)
        {
            throw new ApiException(400, "invalid_name", "套餐名称需在 1-30 个字符之间");
        }

        if (package.PriceCents is < 1 or > 10_000_000)
        {
            throw new ApiException(400, "invalid_price", "价格需在 0.01-100000 元之间");
        }

        if (package.Credits is < 1 or > 100_000_000)
        {
            throw new ApiException(400, "invalid_credits", "积分数需在 1-1 亿之间");
        }

        if (package.Note.Length > 100) package.Note = package.Note[..100];
    }
}
