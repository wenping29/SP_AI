using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SpServer.Infrastructure;
using SpServer.Domain;

namespace SpServer.Application;

public record ConversationSummaryView(string ClientId, string Title, int MessageCount, long ClientUpdatedAt,
    DateTime CreatedAt, DateTime UpdatedAt);

public record ConversationView(string ClientId, string Title, JsonElement Messages, long ClientUpdatedAt,
    DateTime UpdatedAt);

// 登录用户的聊天记录同步：整段会话快照，按账号隔离
public class ConversationStore(AppDbContext db)
{
    private const int MaxConversations = 100;
    private const int MaxMessages = 200;
    private const int MaxPayloadChars = 1_000_000;

    public async Task<IReadOnlyList<ConversationSummaryView>> ListAsync(int userId, CancellationToken ct)
    {
        var rows = await db.Conversations.AsNoTracking()
            .Where(c => c.UserId == userId)
            .OrderByDescending(c => c.UpdatedAt).ThenByDescending(c => c.Id)
            .ToListAsync(ct);

        return rows.Select(c => new ConversationSummaryView(c.ClientId, c.Title, c.MessageCount,
            c.ClientUpdatedAt, AsUtc(c.CreatedAt), AsUtc(c.UpdatedAt))).ToList();
    }

    public async Task<ConversationView> GetAsync(int userId, string clientId, CancellationToken ct)
    {
        var row = await db.Conversations.AsNoTracking()
            .FirstOrDefaultAsync(c => c.UserId == userId && c.ClientId == clientId, ct)
            ?? throw new ApiException(404, "conversation_not_found", "聊天记录不存在");

        return new ConversationView(row.ClientId, row.Title, ParseMessages(row.MessagesJson),
            row.ClientUpdatedAt, AsUtc(row.UpdatedAt));
    }

    public async Task<ConversationView> UpsertAsync(int userId, string clientId, string? title,
        JsonElement messages, long? clientUpdatedAt, CancellationToken ct)
    {
        var id = NormalizeClientId(clientId);
        if (messages.ValueKind != JsonValueKind.Array)
        {
            throw new ApiException(400, "invalid_messages", "messages 必须是数组");
        }

        var count = messages.GetArrayLength();
        if (count > MaxMessages)
        {
            throw new ApiException(400, "too_many_messages", $"单个会话最多 {MaxMessages} 条消息");
        }

        var json = messages.GetRawText();
        if (json.Length > MaxPayloadChars)
        {
            throw new ApiException(413, "payload_too_large", "会话内容过大，无法同步");
        }

        var now = DateTime.UtcNow;
        var row = await db.Conversations
            .FirstOrDefaultAsync(c => c.UserId == userId && c.ClientId == id, ct);
        if (row is null)
        {
            if (await db.Conversations.CountAsync(c => c.UserId == userId, ct) >= MaxConversations)
            {
                throw new ApiException(409, "too_many_conversations", "聊天记录条数已达上限，请先删除一些");
            }

            row = new Conversation { UserId = userId, ClientId = id, CreatedAt = now };
            db.Conversations.Add(row);
        }

        row.Title = CleanTitle(title);
        row.MessagesJson = json;
        row.MessageCount = count;
        row.ClientUpdatedAt = NormalizeClientAt(clientUpdatedAt, now);
        row.UpdatedAt = now;
        await db.SaveChangesAsync(ct);

        return new ConversationView(row.ClientId, row.Title, messages, row.ClientUpdatedAt,
            AsUtc(row.UpdatedAt));
    }

    public async Task<bool> DeleteAsync(int userId, string clientId, CancellationToken ct)
    {
        var id = (clientId ?? "").Trim();
        var row = await db.Conversations
            .FirstOrDefaultAsync(c => c.UserId == userId && c.ClientId == id, ct);
        if (row is null) return false;

        db.Conversations.Remove(row);
        await db.SaveChangesAsync(ct);
        return true;
    }

    private static JsonElement ParseMessages(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            using var empty = JsonDocument.Parse("[]");
            return empty.RootElement.Clone();
        }
    }

    private static string NormalizeClientId(string? clientId)
    {
        var value = (clientId ?? "").Trim();
        if (value.Length is < 8 or > 64 ||
            !value.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_'))
        {
            throw new ApiException(400, "invalid_client_id", "会话 ID 无效");
        }

        return value;
    }

    private static long NormalizeClientAt(long? clientUpdatedAt, DateTime now)
    {
        var fallback = new DateTimeOffset(now).ToUnixTimeMilliseconds();
        if (clientUpdatedAt is not { } value || value <= 0) return fallback;
        // 客户端时钟可能偏差很大，超过一天就按服务端时间处理
        return Math.Abs(value - fallback) > TimeSpan.FromDays(1).TotalMilliseconds ? fallback : value;
    }

    private static string CleanTitle(string? title)
    {
        var value = (title ?? "").Trim();
        if (value.Length == 0) return "未命名聊天";
        return value.Length <= 120 ? value : value[..120];
    }

    private static DateTime AsUtc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);
}
