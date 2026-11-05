namespace SpServer.Infrastructure;

// 进程启动时间：后台「服务器配置」页用它算运行时长，注册为单例供控制器注入
public sealed class ServerRuntime
{
    public DateTimeOffset StartedAt { get; } = DateTimeOffset.UtcNow;
}
