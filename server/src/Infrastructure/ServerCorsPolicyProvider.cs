using Microsoft.AspNetCore.Cors.Infrastructure;
using SpServer.Application;

namespace SpServer.Infrastructure;

// 允许来源可在后台改：留空沿用「不限制来源」，填写后只放行列出的扩展/站点来源
public sealed class ServerCorsPolicyProvider(ServerConfig settings) : ICorsPolicyProvider
{
    public async Task<CorsPolicy?> GetPolicyAsync(HttpContext context, string? policyName)
    {
        var (origins, _) = await settings.GetAllowedOriginsAsync(context.RequestAborted);
        var builder = new CorsPolicyBuilder().AllowAnyHeader().AllowAnyMethod();
        if (origins.Length == 0) builder.AllowAnyOrigin();
        else builder.WithOrigins(origins);
        return builder.Build();
    }
}
