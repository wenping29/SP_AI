using Microsoft.AspNetCore.Mvc;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.UserInterface.Filters;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 角色：列表同时给管理员页选角色用，所以 admins.manage 也能读
[ApiController]
[Route("api/admin")]
public sealed class RolesController(AdminAccounts accounts) : ControllerBase
{
    [HttpGet("roles")]
    [AdminPermission("roles.view", "admins.manage")]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await accounts.ListRolesAsync(ct));

    [HttpPost("roles")]
    [AdminPermission("roles.manage")]
    public async Task<IActionResult> Create([FromBody] AdminRoleRequest req, CancellationToken ct) =>
        Ok(await accounts.CreateRoleAsync(req.Name, req.Description, req.Permissions, ct));

    [HttpPut("roles/{id:int}")]
    [AdminPermission("roles.manage")]
    public async Task<IActionResult> Update(int id, [FromBody] AdminRoleRequest req,
        CancellationToken ct) =>
        Ok(await accounts.UpdateRoleAsync(id, req.Name, req.Description, req.Permissions, ct));

    [HttpDelete("roles/{id:int}")]
    [AdminPermission("roles.manage")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await accounts.DeleteRoleAsync(id, ct);
        return Ok(new { id, deleted = true });
    }
}
