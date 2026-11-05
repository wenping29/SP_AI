namespace SpServer.Domain;

// 对话消息的值对象：介于接口层与模型网关之间的内部表示。
// 放在领域层，避免基础设施层反向依赖，也供 TokenEstimator 估算开销。
public record ChatMessage(string Role, string Content, IReadOnlyList<string> ImageUrls = default!)
{
    public IReadOnlyList<string> ImageUrls { get; } = ImageUrls ?? [];
}
