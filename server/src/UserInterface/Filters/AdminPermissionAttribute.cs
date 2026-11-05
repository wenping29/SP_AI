using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using SpServer.Application;

namespace SpServer.UserInterface.Filters;

// 后台接口的统一鉴权：原来挂在 /api/admin 分组上的 endpoint filter 改成 action filter。
// 不带参数时只要求已登录；带参数时要求命中任意一个权限（与 AdminIdentity.Has 的语义一致）。
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false)]
public sealed class AdminPermissionAttribute : Attribute, IAsyncActionFilter, IOrderedFilter
{
    private readonly string[] _anyOf;

    public AdminPermissionAttribute(params string[] anyOf) => _anyOf = anyOf;

    // 比 [ApiController] 的模型校验过滤器更早执行，保证未登录请求先返回 401
    public int Order => -3000;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var http = context.HttpContext;
        var auth = http.RequestServices.GetRequiredService<AdminAuth>();
        var identity = await auth.ResolveAsync(http.Request, http.RequestAborted);

        if (identity is null)
        {
            context.Result = new JsonResult(new { code = "unauthorized", message = "未登录或登录已过期，请重新登录" })
            {
                StatusCode = StatusCodes.Status401Unauthorized,
            };
            return;
        }

        if (_anyOf.Length > 0 && !_anyOf.Any(identity.Has))
        {
            context.Result = new JsonResult(new { code = "forbidden", message = "当前角色没有该模块的权限" })
            {
                StatusCode = StatusCodes.Status403Forbidden,
            };
            return;
        }

        http.Items[AdminAuth.IdentityItem] = identity;
        await next();
    }
}
