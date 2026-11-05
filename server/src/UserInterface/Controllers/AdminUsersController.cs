using Microsoft.AspNetCore.Mvc;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.UserInterface.Filters;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 管理员账号：新增、修改、删除；自己不能删自己、不能停用自己
[ApiController]
[Route("api/admin")]
public sealed class AdminUsersController(AdminAccounts accounts) : ControllerBase
{
    [HttpGet("users")]
    [AdminPermission("admins.view")]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await accounts.ListUsersAsync(ct));

    [HttpPost("users")]
    [AdminPermission("admins.manage")]
    public async Task<IActionResult> Create([FromBody] AdminUserCreateRequest req, CancellationToken ct) =>
        Ok(await accounts.CreateUserAsync(req.Username, req.DisplayName, req.RoleId, req.Password, ct));

    [HttpPut("users/{id:int}")]
    [AdminPermission("admins.manage")]
    public async Task<IActionResult> Update(int id, [FromBody] AdminUserUpdateRequest req,
        CancellationToken ct) =>
        Ok(await accounts.UpdateUserAsync(id, req.DisplayName, req.RoleId, req.Password,
            req.IsDisabled, ApiHelpers.CurrentAdmin(HttpContext), ct));

    [HttpDelete("users/{id:int}")]
    [AdminPermission("admins.manage")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await accounts.DeleteUserAsync(id, ApiHelpers.CurrentAdmin(HttpContext), ct);
        return Ok(new { id, deleted = true });
    }
}
