using Microsoft.AspNetCore.Mvc;
using SpServer.Application;
using SpServer.Contracts;
using SpServer.Domain;

namespace SpServer.UserInterface.Controllers;

// 插件端充值：套餐、下单、扫码/轮询、模拟支付，以及易支付异步通知
[ApiController]
[Route("api/pay")]
public sealed class PaymentController(PaymentService payments, CreditService credits) : ControllerBase
{
    [HttpGet("packages")]
    public async Task<IActionResult> Packages(CancellationToken ct) =>
        Ok(await payments.GetPurchaseOptionsAsync(ct));

    [HttpPost("orders")]
    public async Task<IActionResult> CreateOrder([FromBody] PaymentOrderCreateRequest req, CancellationToken ct)
    {
        var account = await credits.AuthenticateAsync(ApiHelpers.Bearer(Request), ct);
        if (req.PackageId is not { } packageId)
        {
            throw new ApiException(400, "invalid_package", "请选择充值套餐");
        }

        return Ok(await payments.CreateOrderAsync(
            account, packageId, req.Channel, RequestBaseUrl(), ct));
    }

    [HttpGet("orders/{orderNo}")]
    public async Task<IActionResult> Order(string orderNo, CancellationToken ct)
    {
        var account = await credits.AuthenticateAsync(ApiHelpers.Bearer(Request), ct);
        return Ok(await payments.GetOrderViewAsync(account, orderNo, ct));
    }

    [HttpGet("orders/{orderNo}/qr")]
    public async Task<IActionResult> Qr(string orderNo, CancellationToken ct)
    {
        var account = await credits.AuthenticateAsync(ApiHelpers.Bearer(Request), ct);
        var order = await payments.GetOrderViewAsync(account, orderNo, ct);
        if (order.Status != PaymentService.StatusPending)
        {
            throw new ApiException(400, "order_not_pending", "订单已结束，无需继续支付");
        }

        var content = order.QrContent.Length > 0 ? order.QrContent : order.PayUrl;
        if (content.Length == 0)
        {
            throw new ApiException(400, "no_qr_content", "该订单没有可扫码的支付链接");
        }

        Response.Headers.CacheControl = "no-store";
        return File(payments.CreateQrPng(content), "image/png");
    }

    [HttpPost("orders/{orderNo}/mock-confirm")]
    public async Task<IActionResult> MockConfirm(string orderNo, CancellationToken ct)
    {
        var account = await credits.AuthenticateAsync(ApiHelpers.Bearer(Request), ct);
        return Ok(await payments.ConfirmMockAsync(account, orderNo, ct));
    }

    // 易支付异步通知：验签、核对商户与金额后幂等入账，成功必须原样返回 success
    [HttpGet("notify/epay")]
    [HttpPost("notify/epay")]
    public async Task<IActionResult> EpayNotify(CancellationToken ct)
    {
        var parameters = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in Request.Query)
        {
            if (item.Value.ToString() is { Length: > 0 } value) parameters[item.Key] = value;
        }

        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync(ct);
            foreach (var item in form)
            {
                if (item.Value.ToString() is { Length: > 0 } value) parameters[item.Key] = value;
            }
        }

        var result = await payments.HandleEpayNotifyAsync(parameters, ct);
        return Content(result.Ok ? "success" : "fail", "text/plain");
    }

    [HttpGet("return/epay")]
    public IActionResult EpayReturn() => Content("""
        <!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>支付完成</title></head>
        <body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f6f7fb">
        <div style="text-align:center">
          <h2>支付已完成</h2>
          <p style="color:#666">请返回 SP 助手查看积分余额，到账可能有几秒延迟。</p>
        </div></body></html>
        """, "text/html; charset=utf-8");

    private string RequestBaseUrl() => $"{Request.Scheme}://{Request.Host}";
}
