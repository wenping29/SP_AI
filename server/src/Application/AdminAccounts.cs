using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Application;

public record AdminUserView(int Id, string Username, string DisplayName, int RoleId, string RoleName,
    bool IsDisabled, DateTime CreatedAt, DateTime? LastLoginAt);

public record AdminRoleView(int Id, string Name, string Description, string[] Permissions, bool IsSystem,
    int UserCount, DateTime CreatedAt, DateTime UpdatedAt);

// 后台管理员与角色的增删改查；约束自己不能删自己、不能移除最后一名启用的超级管理员
public class AdminAccounts(AppDbContext db, AdminAuth auth)
{
    private static readonly Regex UsernamePattern = new("^[A-Za-z0-9_.-]{3,32}$", RegexOptions.Compiled);

    public async Task<IReadOnlyList<AdminUserView>> ListUsersAsync(CancellationToken ct)
    {
        var rows = await (from u in db.AdminUsers.AsNoTracking()
                          join r in db.AdminRoles.AsNoTracking() on u.RoleId equals r.Id into roles
                          from r in roles.DefaultIfEmpty()
                          orderby u.Id
                          select new
                          {
                              u.Id, u.Username, u.DisplayName, u.RoleId,
                              RoleName = r == null ? "未分配" : r.Name,
                              u.IsDisabled, u.CreatedAt, u.LastLoginAt,
                          }).ToListAsync(ct);

        return rows.Select(u => new AdminUserView(u.Id, u.Username, u.DisplayName, u.RoleId, u.RoleName,
            u.IsDisabled, AsUtc(u.CreatedAt), AsUtcOrNull(u.LastLoginAt))).ToList();
    }

    public async Task<AdminUserView> CreateUserAsync(string? username, string? displayName, int? roleId,
        string? password, CancellationToken ct)
    {
        var name = (username ?? "").Trim();
        if (!UsernamePattern.IsMatch(name))
        {
            throw new ApiException(400, "invalid_username", "用户名需为 3-32 位字母、数字、下划线、点或短横线");
        }

        var lowered = name.ToLower();
        if (await db.AdminUsers.AnyAsync(u => u.Username.ToLower() == lowered, ct))
        {
            throw new ApiException(409, "username_exists", $"用户名 {name} 已存在");
        }

        var role = await db.AdminRoles.FirstOrDefaultAsync(r => r.Id == roleId, ct)
            ?? throw new ApiException(400, "role_not_found", "请选择有效的角色");

        if ((password ?? "").Length < 8)
        {
            throw new ApiException(400, "weak_password", "密码至少 8 位");
        }

        var now = DateTime.UtcNow;
        var user = new AdminUser
        {
            Username = name,
            DisplayName = CleanDisplayName(displayName, name),
            RoleId = role.Id,
            CreatedAt = now,
        };
        user.PasswordHash = auth.HashPassword(user, password!);

        db.AdminUsers.Add(user);
        await db.SaveChangesAsync(ct);
        return new AdminUserView(user.Id, user.Username, user.DisplayName, user.RoleId, role.Name,
            user.IsDisabled, AsUtc(user.CreatedAt), AsUtcOrNull(user.LastLoginAt));
    }

    public async Task<AdminUserView> UpdateUserAsync(int id, string? displayName, int? roleId, string? password,
        bool? isDisabled, AdminIdentity current, CancellationToken ct)
    {
        var user = await db.AdminUsers.FirstOrDefaultAsync(u => u.Id == id, ct)
            ?? throw new ApiException(404, "admin_user_not_found", "管理员不存在");

        var oldRole = await db.AdminRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == user.RoleId, ct);
        var newRole = oldRole;
        var roleChanged = false;

        if (roleId is { } targetRoleId && targetRoleId != user.RoleId)
        {
            roleChanged = true;
            if (user.Id == current.UserId)
            {
                throw new ApiException(409, "self_role", "不能修改自己的角色，请让其他管理员操作");
            }

            newRole = await db.AdminRoles.FirstOrDefaultAsync(r => r.Id == targetRoleId, ct)
                ?? throw new ApiException(400, "role_not_found", "请选择有效的角色");
        }

        var disabling = isDisabled == true && !user.IsDisabled;
        if (user.Id == current.UserId && disabling)
        {
            throw new ApiException(409, "self_disable", "不能停用自己的账号");
        }

        var wasSuper = !user.IsDisabled && IsSuperRole(oldRole);
        var willBeSuper = !(isDisabled ?? user.IsDisabled) && IsSuperRole(newRole);
        if (wasSuper && !willBeSuper && await ActiveSuperAdminCountAsync(ct) <= 1)
        {
            throw new ApiException(409, "last_superadmin", "至少保留一名启用的超级管理员");
        }

        if (displayName is not null) user.DisplayName = CleanDisplayName(displayName, user.Username);
        if (roleId is { } rid) user.RoleId = rid;
        if (isDisabled is { } disabled) user.IsDisabled = disabled;

        var passwordChanged = !string.IsNullOrEmpty(password);
        if (passwordChanged)
        {
            if (password!.Length < 8) throw new ApiException(400, "weak_password", "密码至少 8 位");
            user.PasswordHash = auth.HashPassword(user, password);
        }

        await db.SaveChangesAsync(ct);

        // 改角色、停用或由他人重置密码后，旧会话立即失效；自己改密码不影响当前会话
        if (user.Id != current.UserId && (passwordChanged || roleChanged || disabling))
        {
            await auth.RevokeSessionsAsync(user.Id, ct);
        }

        return new AdminUserView(user.Id, user.Username, user.DisplayName, user.RoleId,
            newRole?.Name ?? "未分配", user.IsDisabled, AsUtc(user.CreatedAt), AsUtcOrNull(user.LastLoginAt));
    }

    public async Task DeleteUserAsync(int id, AdminIdentity current, CancellationToken ct)
    {
        var user = await db.AdminUsers.FirstOrDefaultAsync(u => u.Id == id, ct)
            ?? throw new ApiException(404, "admin_user_not_found", "管理员不存在");

        if (user.Id == current.UserId)
        {
            throw new ApiException(409, "self_delete", "不能删除自己的账号");
        }

        var role = await db.AdminRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == user.RoleId, ct);
        if (!user.IsDisabled && IsSuperRole(role) && await ActiveSuperAdminCountAsync(ct) <= 1)
        {
            throw new ApiException(409, "last_superadmin", "至少保留一名启用的超级管理员");
        }

        await auth.RevokeSessionsAsync(user.Id, ct);
        db.AdminUsers.Remove(user);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AdminRoleView>> ListRolesAsync(CancellationToken ct)
    {
        var roles = await db.AdminRoles.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct);
        var counts = await db.AdminUsers.AsNoTracking()
            .GroupBy(u => u.RoleId)
            .Select(g => new { RoleId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.RoleId, x => x.Count, ct);

        return roles.Select(r => View(r, counts.GetValueOrDefault(r.Id))).ToList();
    }

    public async Task<AdminRoleView> CreateRoleAsync(string? name, string? description,
        string[]? permissions, CancellationToken ct)
    {
        var roleName = CleanRoleName(name);
        if (await db.AdminRoles.AnyAsync(r => r.Name.ToLower() == roleName.ToLower(), ct))
        {
            throw new ApiException(409, "role_name_exists", $"角色 {roleName} 已存在");
        }

        var now = DateTime.UtcNow;
        var role = new AdminRole
        {
            Name = roleName,
            Description = CleanDescription(description),
            Permissions = JsonOf(permissions),
            CreatedAt = now,
            UpdatedAt = now,
        };

        db.AdminRoles.Add(role);
        await db.SaveChangesAsync(ct);
        return View(role, 0);
    }

    public async Task<AdminRoleView> UpdateRoleAsync(int id, string? name, string? description,
        string[]? permissions, CancellationToken ct)
    {
        var role = await db.AdminRoles.FirstOrDefaultAsync(r => r.Id == id, ct)
            ?? throw new ApiException(404, "role_not_found", "角色不存在");

        if (role.IsSystem)
        {
            throw new ApiException(409, "system_role", "系统内置角色不能修改");
        }

        if (name is not null)
        {
            var roleName = CleanRoleName(name);
            if (await db.AdminRoles.AnyAsync(r => r.Id != id && r.Name.ToLower() == roleName.ToLower(), ct))
            {
                throw new ApiException(409, "role_name_exists", $"角色 {roleName} 已存在");
            }

            role.Name = roleName;
        }

        if (description is not null) role.Description = CleanDescription(description);
        if (permissions is not null) role.Permissions = JsonOf(permissions);

        role.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var userCount = await db.AdminUsers.CountAsync(u => u.RoleId == role.Id, ct);
        return View(role, userCount);
    }

    public async Task DeleteRoleAsync(int id, CancellationToken ct)
    {
        var role = await db.AdminRoles.FirstOrDefaultAsync(r => r.Id == id, ct)
            ?? throw new ApiException(404, "role_not_found", "角色不存在");

        if (role.IsSystem)
        {
            throw new ApiException(409, "system_role", "系统内置角色不能删除");
        }

        var userCount = await db.AdminUsers.CountAsync(u => u.RoleId == role.Id, ct);
        if (userCount > 0)
        {
            throw new ApiException(409, "role_in_use", $"还有 {userCount} 名管理员使用该角色，请先调整角色");
        }

        db.AdminRoles.Remove(role);
        await db.SaveChangesAsync(ct);
    }

    private static AdminRoleView View(AdminRole role, int userCount) => new(
        role.Id, role.Name, role.Description, AdminAuth.ParsePermissions(role.Permissions),
        role.IsSystem, userCount, AsUtc(role.CreatedAt), AsUtc(role.UpdatedAt));

    private static bool IsSuperRole(AdminRole? role) =>
        role is not null && AdminAuth.ParsePermissions(role.Permissions).Contains(AdminPermissions.All);

    private async Task<int> ActiveSuperAdminCountAsync(CancellationToken ct)
    {
        var roles = await db.AdminRoles.AsNoTracking().ToListAsync(ct);
        var superRoleIds = roles.Where(IsSuperRole).Select(r => r.Id).ToList();
        return await db.AdminUsers.CountAsync(u => !u.IsDisabled && superRoleIds.Contains(u.RoleId), ct);
    }

    private static string CleanRoleName(string? name)
    {
        var value = (name ?? "").Trim();
        if (value.Length is < 1 or > 30) throw new ApiException(400, "invalid_role_name", "角色名需为 1-30 个字符");
        return value;
    }

    private static string CleanDescription(string? description)
    {
        var value = (description ?? "").Trim();
        return value.Length <= 200 ? value : value[..200];
    }

    private static string CleanDisplayName(string? displayName, string fallback)
    {
        var value = (displayName ?? "").Trim();
        if (value.Length == 0) return fallback;
        return value.Length <= 50 ? value : value[..50];
    }

    private static string JsonOf(string[]? permissions)
    {
        var list = (permissions ?? [])
            .Select(p => (p ?? "").Trim())
            .Where(p => p.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        foreach (var permission in list)
        {
            if (!AdminPermissions.IsValid(permission))
            {
                throw new ApiException(400, "invalid_permission", $"未知权限 {permission}");
            }

            if (permission == AdminPermissions.All)
            {
                throw new ApiException(400, "invalid_permission", "只有系统内置角色拥有全部权限");
            }
        }

        return System.Text.Json.JsonSerializer.Serialize(list);
    }

    private static DateTime AsUtc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static DateTime? AsUtcOrNull(DateTime value) =>
        value == default ? null : DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
