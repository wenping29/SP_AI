namespace SpServer.Domain;

public static class TokenEstimator
{
    public const int ImageTokens = 800;

    // 中文约 1.5 字符一个 token，其余约 4 字符一个 token，用于预扣与预算展示
    public static int Estimate(string text)
    {
        var cjk = 0;
        var other = 0;
        foreach (var ch in text)
        {
            if (ch >= 0x4E00 && ch <= 0x9FFF) cjk++;
            else if (!char.IsWhiteSpace(ch)) other++;
        }

        return (int)Math.Ceiling(cjk / 1.5 + other / 4.0);
    }

    public static int Charge(int tokens, int ratePer1K) =>
        ratePer1K <= 0 || tokens <= 0 ? 0 : (int)Math.Ceiling(tokens / 1000.0) * ratePer1K;

    // 图片按视觉模型的常见切片开销估算，上游没回 usage 时与预扣口径保持一致
    public static int EstimateMessage(ChatMessage message) =>
        Estimate(message.Content) + ImageTokens * message.ImageUrls.Count;
}
