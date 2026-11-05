using Microsoft.AspNetCore.Mvc;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.UserInterface.Filters;
using SpServer.Application;

namespace SpServer.UserInterface.Controllers;

// 普通用户（插件端注册）：与管理员分表，支持新增、编辑、重置密码、封禁与删除
// 积分管理页按用户展示，设备运营角色（devices.view）也需要读用户列表
[ApiController]
[Route("api/admin")]
public sealed class MembersController(MemberAdmin members) : ControllerBase
{
    [HttpGet("members")]
    [AdminPermission("users.view", "devices.view")]
    public async Task<IActionResult> List([FromQuery] string? q, [FromQuery] int? page,
        [FromQuery] int? pageSize, CancellationToken ct) =>
        Ok(await members.ListAsync(q, page ?? 1, pageSize ?? 20, ct));

    [HttpPost("members")]
    [AdminPermission("users.manage")]
    public async Task<IActionResult> Create([FromBody] MemberCreateRequest req, CancellationToken ct) =>
        Ok(await members.CreateAsync(req.Email, req.DisplayName, req.Password, ct));

    [HttpPut("members/{id:int}")]
    [AdminPermission("users.manage")]
    public async Task<IActionResult> Update(int id, [FromBody] MemberUpdateRequest req,
        CancellationToken ct) =>
        Ok(await members.UpdateAsync(id, req.Email, req.DisplayName, req.Password, ct));

    [HttpPost("members/{id:int}/block")]
    [AdminPermission("users.manage")]
    public async Task<IActionResult> Block(int id, [FromBody] MemberBlockRequest req,
        CancellationToken ct) =>
        Ok(await members.BlockAsync(id, req.Blocked ?? false, ct));

    [HttpDelete("members/{id:int}")]
    [AdminPermission("users.manage")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await members.DeleteAsync(id, ct);
        return Ok(new { id, deleted = true });
    }
}
