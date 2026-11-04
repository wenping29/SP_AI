namespace SpServer.Services;

// 密钥只从环境变量读，配置里只放变量名，避免把上游 Key 写进仓库或数据库
public static class ProviderKey
{
    public static string? Resolve(IConfiguration config, ILogger logger, string provider)
    {
        var envName = config[$"Providers:{provider}:KeyEnv"] ?? $"{provider.ToUpperInvariant()}_API_KEY";
        var value = Environment.GetEnvironmentVariable(envName);
        if (string.IsNullOrWhiteSpace(value))
        {
            logger.LogWarning("提供商 {Provider} 未配置密钥（环境变量 {EnvName} 为空）", provider, envName);
            return null;
        }

        return value;
    }
}
