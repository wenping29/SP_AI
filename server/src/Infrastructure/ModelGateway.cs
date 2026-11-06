using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SpServer.Domain;

namespace SpServer.Infrastructure;

public record CompletionUsage(int InputTokens, int OutputTokens, bool FromUpstream);

// 上游流式增量有两种通道：思考过程与正式回答，两者都要推给前端，只有回答计入正文
public enum DeltaKind
{
    Content,
    Reasoning,
}

public class ModelGateway(IHttpClientFactory httpFactory, IConfiguration config, ProviderKey providerKeys,
    ILogger<ModelGateway> logger)
{
    public async Task<CompletionUsage> StreamAsync(ModelSpec model, IReadOnlyList<ChatMessage> messages,
        int maxTokens, Func<DeltaKind, string, Task> onDelta, CancellationToken ct)
    {
        var key = await providerKeys.ResolveAsync(model.Provider, ct);
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new ApiException(503, "provider_not_configured",
                $"「{model.DisplayName}」暂未开放，管理员需先为该模型配置密钥");
        }

        var baseUrl = config[$"Providers:{model.Provider}:BaseUrl"]
            ?? throw new ApiException(500, "no_base_url", $"未配置 {model.Provider} 的 BaseUrl");

        var payload = new JsonObject
        {
            ["model"] = model.UpstreamModel,
            ["max_tokens"] = maxTokens,
            ["stream"] = true,
            ["messages"] = new JsonArray(messages
                .Select(m => (JsonNode)new JsonObject { ["role"] = m.Role, ["content"] = ContentNode(m) })
                .ToArray()),
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl.TrimEnd('/')}/chat/completions")
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new("Bearer", key);

        var client = httpFactory.CreateClient("upstream");
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);

        if (!response.IsSuccessStatusCode)
        {
            var status = (int)response.StatusCode;
            var body = await response.Content.ReadAsStringAsync(ct);
            logger.LogWarning("上游 {Provider}/{Model} 返回 {Status}: {Body}",
                model.Provider, model.UpstreamModel, status, Truncate(body, 500));
            // 响应体只进日志，不转发给用户：上游报文可能回显密钥片段
            throw new ApiException(502, "upstream_error", status switch
            {
                401 or 403 => "模型服务鉴权失败，请管理员检查密钥配置",
                429 => "模型服务当前限流，请稍后重试",
                _ => $"模型服务暂时不可用（{status}），请稍后重试",
            });
        }

        var content = new StringBuilder();
        var reasoning = new StringBuilder();
        var inputTokens = 0;
        var outputTokens = 0;
        var fromUpstream = false;

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        string? line;
        while ((line = await reader.ReadLineAsync(ct)) is not null)
        {
            if (!line.StartsWith("data:")) continue;

            var data = line[5..].Trim();
            if (data.Length == 0 || data == "[DONE]") continue;

            JsonNode? node;
            try { node = JsonNode.Parse(data); }
            catch (JsonException) { continue; }
            if (node is null) continue;

            if (node["usage"] is JsonObject usage)
            {
                inputTokens = usage["prompt_tokens"]?.GetValue<int>() ?? inputTokens;
                outputTokens = usage["completion_tokens"]?.GetValue<int>() ?? outputTokens;
                fromUpstream = inputTokens > 0 || outputTokens > 0;
            }

            // 通义等上游会在最后一个事件里只带 usage，choices 是空数组；直接取 [0] 会抛索引越界，
            // 正文已经流完了却在收尾处断掉，前端就看到“已中断”
            var choice = (node["choices"] as JsonArray)?.FirstOrDefault() as JsonObject;
            var deltaNode = choice?["delta"] as JsonObject;
            var text = AsText(deltaNode?["content"]);
            if (!string.IsNullOrEmpty(text))
            {
                content.Append(text);
                await onDelta(DeltaKind.Content, text);
            }

            // 推理模型（deepseek-reasoner、qwen qwq、glm thinking 等）把思考过程放在这个字段，上游不给就不显示
            var think = AsText(deltaNode?["reasoning_content"]);
            if (!string.IsNullOrEmpty(think))
            {
                reasoning.Append(think);
                await onDelta(DeltaKind.Reasoning, think);
            }
        }

        if (!fromUpstream)
        {
            inputTokens = messages.Sum(TokenEstimator.EstimateMessage);
            // 没有 usage 时按估算兜底，思考 token 也算钱，否则推理模型可以白嫖
            outputTokens = TokenEstimator.Estimate(content.ToString()) + TokenEstimator.Estimate(reasoning.ToString());
        }

        return new CompletionUsage(inputTokens, outputTokens, fromUpstream);
    }

    /// 有图片时按 OpenAI 多模态格式发 content parts，纯文本保持字符串形式以兼容旧模型
    private static JsonNode ContentNode(ChatMessage message)
    {
        if (message.ImageUrls.Count == 0) return JsonValue.Create(message.Content ?? "")!;

        var parts = new List<JsonNode?>();
        if (!string.IsNullOrEmpty(message.Content))
        {
            parts.Add(new JsonObject { ["type"] = "text", ["text"] = message.Content });
        }

        foreach (var url in message.ImageUrls)
        {
            parts.Add(new JsonObject
            {
                ["type"] = "image_url",
                ["image_url"] = new JsonObject { ["url"] = url },
            });
        }

        return new JsonArray([.. parts]);
    }

    // 上游偶尔把 content 发成 null 之外的类型，取值前先确认是字符串，免得整条流被异常打断
    private static string? AsText(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static string Truncate(string text, int max) =>
        text.Length <= max ? text : text[..max] + "…";
}
