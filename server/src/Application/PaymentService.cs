using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using QRCoder;
using SpServer.Contracts;
using SpServer.Domain;
using SpServer.Infrastructure;

namespace SpServer.Application;

public record PaymentPackageView(int Id, string Name, int PriceCents, int Credits, string Note, int SortOrder);

public record PurchaseOptionsView(
    bool Enabled,
    string Provider,
    bool AlipayEnabled,
    bool WechatEnabled,
    bool MockEnabled,
    List<PaymentPackageView> Packages);

public record PaymentSettingsView(
    bool Enabled,
    string Provider,
    bool MockEnabled,
    string EpayApiUrl,
    string EpayPid,
    bool EpayKeySet,
    string EpayKeyTail,
    bool AlipayEnabled,
    bool WechatEnabled,
    string NotifyBaseUrl,
    DateTime UpdatedAt);

public record PaymentOrderView(
    string OrderNo,
    string PackageName,
    int PriceCents,
    int Credits,
    string Channel,
    string Provider,
    string Status,
    string PayUrl,
    string QrContent,
    string ExternalOrderNo,
    string ExpiresAt,
    string? PaidAt,
    int Balance);

// 充值：套餐下单、第三方聚合支付（易支付）与模拟支付；到账只认 pending → paid 的条件更新，重复回调不会重复加分
public class PaymentService(
    AppDbContext db,
    CreditService credits,
    IHttpClientFactory httpFactory,
    IDataProtectionProvider protection,
    ILogger<PaymentService> logger)
{
    public const string StatusPending = "pending";
    public const string StatusPaid = "paid";
    public const string StatusClosed = "closed";

    private const string KeyPurpose = "SpServer.EpayKey.v1";
    private const int OrderMinutes = 15;

    public async Task<PaymentSetting> GetSettingsAsync(CancellationToken ct) =>
        await db.PaymentSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Id == 1, ct)
        ?? new PaymentSetting();

    public async Task<PaymentSettingsView> GetSettingsViewAsync(CancellationToken ct)
    {
        var row = await GetSettingsAsync(ct);
        return new PaymentSettingsView(
            row.Enabled,
            row.Provider,
            row.MockEnabled,
            row.EpayApiUrl,
            row.EpayPid,
            !string.IsNullOrWhiteSpace(row.EpayKeyCipher),
            row.EpayKeyTail,
            row.AlipayEnabled,
            row.WechatEnabled,
            row.NotifyBaseUrl,
            ApiTime(row.UpdatedAt));
    }

    public async Task SaveSettingsAsync(PaymentSettingsRequest req, CancellationToken ct)
    {
        var row = await db.PaymentSettings.FirstOrDefaultAsync(s => s.Id == 1, ct);
        if (row is null)
        {
            row = new PaymentSetting { Id = 1 };
            db.PaymentSettings.Add(row);
        }

        if (req.Enabled is { } enabled) row.Enabled = enabled;
        if (req.Provider is not null)
        {
            var provider = req.Provider.Trim().ToLowerInvariant();
            if (provider is not ("mock" or "epay"))
            {
                throw new ApiException(400, "invalid_provider", "支付渠道只能是 mock 或 epay");
            }

            row.Provider = provider;
        }

        if (req.MockEnabled is { } mockEnabled) row.MockEnabled = mockEnabled;
        if (req.AlipayEnabled is { } alipay) row.AlipayEnabled = alipay;
        if (req.WechatEnabled is { } wechat) row.WechatEnabled = wechat;

        if (req.EpayApiUrl is not null)
        {
            row.EpayApiUrl = req.EpayApiUrl.Trim();
            if (row.EpayApiUrl.Length > 0
                && (!Uri.TryCreate(row.EpayApiUrl, UriKind.Absolute, out var api)
                    || (api.Scheme != Uri.UriSchemeHttp && api.Scheme != Uri.UriSchemeHttps)))
            {
                throw new ApiException(400, "invalid_epay_url", "易支付接口地址需以 http:// 或 https:// 开头");
            }
        }

        if (req.EpayPid is not null) row.EpayPid = req.EpayPid.Trim();

        // 密钥只进不出：留空表示不修改，清空需要显式传 clearEpayKey
        if (req.ClearEpayKey == true)
        {
            row.EpayKeyCipher = "";
            row.EpayKeyTail = "";
        }
        else if (!string.IsNullOrWhiteSpace(req.EpayKey))
        {
            var key = req.EpayKey.Trim();
            row.EpayKeyCipher = ProtectKey(key);
            row.EpayKeyTail = key.Length <= 4 ? key : key[^4..];
        }

        if (req.NotifyBaseUrl is not null)
        {
            var baseUrl = req.NotifyBaseUrl.Trim().TrimEnd('/');
            if (baseUrl.Length > 0
                && (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri)
                    || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)))
            {
                throw new ApiException(400, "invalid_notify_base", "回调地址需以 http:// 或 https:// 开头");
            }

            row.NotifyBaseUrl = baseUrl;
        }

        if (!row.AlipayEnabled && !row.WechatEnabled)
        {
            throw new ApiException(400, "no_channel", "至少开放支付宝或微信其中一个支付渠道");
        }

        if (row.Enabled)
        {
            if (row.Provider == "mock" && !row.MockEnabled)
            {
                throw new ApiException(400, "mock_disabled", "使用模拟支付时必须同时打开「允许模拟支付」");
            }

            if (row.Provider == "epay")
            {
                if (row.EpayApiUrl.Length == 0 || row.EpayPid.Length == 0)
                {
                    throw new ApiException(400, "epay_incomplete", "启用易支付前请填写接口地址与商户 PID");
                }

                if (string.IsNullOrWhiteSpace(UnprotectKey(row.EpayKeyCipher)))
                {
                    throw new ApiException(400, "epay_key_missing", "启用易支付前请填写商户密钥");
                }
            }
        }

        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        logger.LogInformation("支付配置已更新（启用 {Enabled}，渠道 {Provider}）", row.Enabled, row.Provider);
    }

    public async Task<PurchaseOptionsView> GetPurchaseOptionsAsync(CancellationToken ct)
    {
        var row = await GetSettingsAsync(ct);
        var packages = await db.CreditPackages.AsNoTracking()
            .Where(p => p.IsEnabled)
            .OrderBy(p => p.SortOrder).ThenBy(p => p.Id)
            .Select(p => new PaymentPackageView(p.Id, p.Name, p.PriceCents, p.Credits, p.Note, p.SortOrder))
            .ToListAsync(ct);

        return new PurchaseOptionsView(
            row.Enabled,
            row.Provider,
            row.AlipayEnabled,
            row.WechatEnabled,
            row.MockEnabled,
            packages);
    }

    public async Task<PaymentOrderView> CreateOrderAsync(
        Account account, int packageId, string? channel, string requestBaseUrl, CancellationToken ct)
    {
        var userId = account.UserId
            ?? throw new ApiException(401, "login_required", "请先登录账号再充值，积分会跟随账号保存");

        var settings = await GetSettingsAsync(ct);
        if (!settings.Enabled) throw new ApiException(400, "payment_disabled", "充值功能暂未开放");
        if (settings.Provider == "mock" && !settings.MockEnabled)
        {
            throw new ApiException(400, "payment_disabled", "模拟支付未开启");
        }

        var package = await db.CreditPackages.FirstOrDefaultAsync(p => p.Id == packageId && p.IsEnabled, ct)
            ?? throw new ApiException(404, "package_not_found", "套餐不存在或已下架");
        if (package.PriceCents <= 0 || package.Credits <= 0)
        {
            throw new ApiException(400, "invalid_package", "套餐价格与积分必须大于 0");
        }

        var payChannel = (channel ?? "").Trim().ToLowerInvariant() switch
        {
            "alipay" => "alipay",
            "wechat" or "wxpay" => "wechat",
            _ => throw new ApiException(400, "invalid_channel", "请选择支付宝或微信支付"),
        };
        if (payChannel == "alipay" && !settings.AlipayEnabled)
        {
            throw new ApiException(400, "channel_disabled", "支付宝支付暂未开放");
        }

        if (payChannel == "wechat" && !settings.WechatEnabled)
        {
            throw new ApiException(400, "channel_disabled", "微信支付暂未开放");
        }

        var now = DateTime.UtcNow;
        // 同一用户未支付的旧订单先关掉，避免同一套餐残留多笔待支付
        await db.PaymentOrders
            .Where(o => o.UserId == userId && o.Status == StatusPending && o.ExpiresAt < now)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, StatusClosed), ct);

        var order = new PaymentOrder
        {
            OrderNo = await NewOrderNoAsync(ct),
            UserId = userId,
            AccountId = account.Id,
            PackageId = package.Id,
            PackageName = package.Name,
            PriceCents = package.PriceCents,
            Credits = package.Credits,
            Channel = payChannel,
            Provider = settings.Provider,
            Status = StatusPending,
            CreatedAt = now,
            ExpiresAt = now.AddMinutes(OrderMinutes),
        };

        db.PaymentOrders.Add(order);
        await db.SaveChangesAsync(ct);

        if (settings.Provider == "epay")
        {
            try
            {
                await FillEpayOrderAsync(order, settings, requestBaseUrl, ct);
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                order.Status = StatusClosed;
                await db.SaveChangesAsync(ct);
                if (ex is ApiException) throw;
                logger.LogWarning(ex, "易支付下单失败 {OrderNo}", order.OrderNo);
                throw new ApiException(502, "payment_gateway_error", "支付渠道暂时不可用，请稍后重试");
            }
        }

        return ToView(order, account.Balance);
    }

    public async Task<PaymentOrderView> GetOrderViewAsync(Account account, string orderNo, CancellationToken ct)
    {
        var order = await FindOrderAsync(account, orderNo, ct);
        await CloseIfExpiredAsync(order, ct);
        var balance = await db.Accounts.Where(a => a.Id == account.Id).Select(a => a.Balance).FirstAsync(ct);
        return ToView(order, balance);
    }

    public async Task<PaymentOrderView> ConfirmMockAsync(Account account, string orderNo, CancellationToken ct)
    {
        var settings = await GetSettingsAsync(ct);
        if (!settings.Enabled || settings.Provider != "mock" || !settings.MockEnabled)
        {
            throw new ApiException(403, "mock_disabled", "模拟支付未开启");
        }

        var order = await FindOrderAsync(account, orderNo, ct);
        if (order.Provider != "mock")
        {
            throw new ApiException(400, "not_mock_order", "该订单不是模拟支付订单");
        }

        if (order.Status != StatusPending)
        {
            throw new ApiException(400, "order_not_pending", "订单已结束，请重新下单");
        }

        if (order.ExpiresAt < DateTime.UtcNow)
        {
            await CloseIfExpiredAsync(order, ct);
            throw new ApiException(400, "order_expired", "订单已过期，请重新下单");
        }

        await MarkPaidAsync(orderNo, $"MOCK-{orderNo}", ct);
        return await GetOrderViewAsync(account, orderNo, ct);
    }

    // 到账：先以 pending 为条件抢占订单，再在同一个事务里加积分与写流水；并发回调只会成功一次
    public async Task<bool> MarkPaidAsync(string orderNo, string? externalOrderNo, CancellationToken ct)
    {
        var order = await db.PaymentOrders.AsNoTracking()
            .FirstOrDefaultAsync(o => o.OrderNo == orderNo, ct);
        if (order is null || order.Status != StatusPending) return false;

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var paidAt = DateTime.UtcNow;
        var affected = await db.PaymentOrders
            .Where(o => o.OrderNo == orderNo && o.Status == StatusPending)
            .ExecuteUpdateAsync(s => s
                .SetProperty(o => o.Status, StatusPaid)
                .SetProperty(o => o.PaidAt, (DateTime?)paidAt)
                .SetProperty(o => o.ExternalOrderNo,
                    o => string.IsNullOrEmpty(externalOrderNo) ? o.ExternalOrderNo : externalOrderNo), ct);

        if (affected == 0)
        {
            await tx.RollbackAsync(ct);
            return false;
        }

        await credits.AdjustBalanceAsync(order.AccountId, order.Credits, "recharge", ct);
        await tx.CommitAsync(ct);
        logger.LogInformation("充值到账 {OrderNo} 用户 {UserId} 积分 {Credits}", orderNo, order.UserId, order.Credits);
        return true;
    }

    public async Task<(bool Ok, string Message)> HandleEpayNotifyAsync(
        IReadOnlyDictionary<string, string> parameters, CancellationToken ct)
    {
        var settings = await GetSettingsAsync(ct);
        if (settings.Provider != "epay") return (false, "provider_mismatch");

        var key = UnprotectKey(settings.EpayKeyCipher);
        if (string.IsNullOrWhiteSpace(key)) return (false, "key_missing");
        if (!VerifyEpaySign(parameters, key)) return (false, "bad_sign");

        if (parameters.TryGetValue("pid", out var pid) && pid != settings.EpayPid) return (false, "bad_pid");
        if (!parameters.TryGetValue("trade_status", out var tradeStatus)
            || tradeStatus is not ("TRADE_SUCCESS" or "TRADE_FINISHED"))
        {
            return (false, "bad_status");
        }

        if (!parameters.TryGetValue("out_trade_no", out var orderNo) || string.IsNullOrWhiteSpace(orderNo))
        {
            return (false, "missing_order");
        }

        var order = await db.PaymentOrders.AsNoTracking()
            .FirstOrDefaultAsync(o => o.OrderNo == orderNo, ct);
        if (order is null) return (false, "order_not_found");
        if (order.Provider != "epay") return (false, "provider_mismatch");
        if (order.Status == StatusPaid) return (true, "already_paid");

        if (!parameters.TryGetValue("money", out var moneyText)
            || !decimal.TryParse(moneyText, NumberStyles.Number, CultureInfo.InvariantCulture, out var money)
            || (int)decimal.Round(money * 100m) != order.PriceCents)
        {
            logger.LogWarning("易支付回调金额不匹配 {OrderNo}：{Money}", orderNo, moneyText);
            return (false, "bad_amount");
        }

        var tradeNo = parameters.TryGetValue("trade_no", out var trade) ? trade : null;
        var ok = await MarkPaidAsync(orderNo, tradeNo, ct);
        return (ok, ok ? "success" : "order_not_pending");
    }

    public byte[] CreateQrPng(string content)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(content, QRCodeGenerator.ECCLevel.Q);
        using var png = new PngByteQRCode(data);
        return png.GetGraphic(8);
    }

    private async Task<PaymentOrder> FindOrderAsync(Account account, string orderNo, CancellationToken ct)
    {
        var userId = account.UserId
            ?? throw new ApiException(401, "login_required", "请先登录账号再充值");
        // 用 AsNoTracking 保证 ExecuteUpdate 改过的状态能立刻读到，而不是命中上下文里的旧快照
        return await db.PaymentOrders.AsNoTracking().FirstOrDefaultAsync(
                   o => o.OrderNo == orderNo && o.UserId == userId, ct)
               ?? throw new ApiException(404, "order_not_found", "订单不存在");
    }

    private async Task CloseIfExpiredAsync(PaymentOrder order, CancellationToken ct)
    {
        if (order.Status != StatusPending || order.ExpiresAt >= DateTime.UtcNow) return;
        var affected = await db.PaymentOrders
            .Where(o => o.OrderNo == order.OrderNo && o.Status == StatusPending)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, StatusClosed), ct);
        if (affected > 0) order.Status = StatusClosed;
    }

    private async Task FillEpayOrderAsync(
        PaymentOrder order, PaymentSetting settings, string requestBaseUrl, CancellationToken ct)
    {
        var baseUrl = (string.IsNullOrWhiteSpace(settings.NotifyBaseUrl)
                ? requestBaseUrl
                : settings.NotifyBaseUrl)
            .TrimEnd('/');

        var parameters = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["pid"] = settings.EpayPid,
            ["type"] = order.Channel == "alipay" ? "alipay" : "wxpay",
            ["out_trade_no"] = order.OrderNo,
            ["notify_url"] = $"{baseUrl}/api/pay/notify/epay",
            ["return_url"] = $"{baseUrl}/api/pay/return/epay",
            ["name"] = $"SP积分-{order.PackageName}",
            ["money"] = (order.PriceCents / 100m).ToString("0.00", CultureInfo.InvariantCulture),
        };
        parameters["sign"] = EpaySign(parameters, UnprotectKey(settings.EpayKeyCipher));
        parameters["sign_type"] = "MD5";

        var query = string.Join('&', parameters.Select(p =>
            $"{Uri.EscapeDataString(p.Key)}={Uri.EscapeDataString(p.Value)}"));
        var joiner = settings.EpayApiUrl.Contains('?') ? '&' : '?';

        using var client = httpFactory.CreateClient("payments");
        using var response = await client.GetAsync($"{settings.EpayApiUrl}{joiner}{query}", ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new ApiException(502, "payment_gateway_error", "支付渠道返回异常");
        }

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var code = ReadString(root, "code");
        if (code != "1")
        {
            var msg = ReadString(root, "msg") ?? "下单失败";
            logger.LogWarning("易支付下单返回 {Code}：{Message}", code, msg);
            throw new ApiException(502, "payment_gateway_error", $"支付渠道下单失败：{msg}");
        }

        order.PayUrl = ReadString(root, "payurl") ?? "";
        order.QrContent = ReadString(root, "qrcode") ?? "";
        order.ExternalOrderNo = ReadString(root, "trade_no") ?? "";
        if (order.PayUrl.Length == 0 && order.QrContent.Length == 0)
        {
            throw new ApiException(502, "payment_gateway_error", "支付渠道未返回收银台地址");
        }
    }

    private async Task<string> NewOrderNoAsync(CancellationToken ct)
    {
        for (var i = 0; i < 5; i++)
        {
            var candidate = $"SP{DateTime.UtcNow:yyyyMMddHHmmss}{RandomNumberGenerator.GetInt32(100000, 1000000)}";
            if (!await db.PaymentOrders.AnyAsync(o => o.OrderNo == candidate, ct)) return candidate;
        }

        throw new ApiException(500, "order_no_conflict", "生成订单号失败，请重试");
    }

    private static PaymentOrderView ToView(PaymentOrder order, int balance) => new(
        order.OrderNo,
        order.PackageName,
        order.PriceCents,
        order.Credits,
        order.Channel,
        order.Provider,
        order.Status,
        order.PayUrl,
        order.QrContent,
        order.ExternalOrderNo,
        ApiTime(order.ExpiresAt).ToString("yyyy-MM-dd HH:mm:ss"),
        order.PaidAt is { } paid ? ApiTime(paid).ToString("yyyy-MM-dd HH:mm:ss") : null,
        balance);

    private static DateTime ApiTime(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc).ToLocalTime();

    private static string? ReadString(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null,
        };
    }

    private string ProtectKey(string key) => protection.CreateProtector(KeyPurpose).Protect(key);

    private string UnprotectKey(string cipher)
    {
        if (string.IsNullOrWhiteSpace(cipher)) return "";
        try
        {
            return protection.CreateProtector(KeyPurpose).Unprotect(cipher);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "易支付商户密钥解密失败，需重新填写");
            return "";
        }
    }

    // 易支付签名：去掉 sign/sign_type 与空值，按参数名排序后拼 k=v&k=v，末尾直接接商户密钥
    private static string EpaySign(IReadOnlyDictionary<string, string> parameters, string key)
    {
        var text = string.Join('&', parameters
            .Where(p => p.Key is not ("sign" or "sign_type") && !string.IsNullOrEmpty(p.Value))
            .OrderBy(p => p.Key, StringComparer.Ordinal)
            .Select(p => $"{p.Key}={p.Value}"));
        return Md5Hex(text + key);
    }

    private static bool VerifyEpaySign(IReadOnlyDictionary<string, string> parameters, string key)
    {
        if (!parameters.TryGetValue("sign", out var sign) || string.IsNullOrWhiteSpace(sign)) return false;
        var expected = EpaySign(parameters, key);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(sign.Trim().ToLowerInvariant()));
    }

    private static string Md5Hex(string text) =>
        Convert.ToHexString(MD5.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
}
