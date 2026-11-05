using System.Reflection;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi;
using SpServer.Domain;
using SpServer.Application;
using SpServer.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// 数据库密钥的加密密钥环放在仓库外，权限收紧；丢失后库里的密文需重新设置
var keysPath = builder.Configuration["Security:KeysPath"] ?? "keys";
if (!Path.IsPathRooted(keysPath)) keysPath = Path.Combine(builder.Environment.ContentRootPath, keysPath);
var keysDir = Directory.CreateDirectory(keysPath);
if (!OperatingSystem.IsWindows())
{
    File.SetUnixFileMode(keysDir.FullName,
        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
}

builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(keysDir)
    .SetApplicationName("SpServer");

// 监听地址默认取 appsettings.json 的 Server:Host / Server:Port；
// 需要临时改端口时仍可用 --urls 或 ASPNETCORE_URLS 覆盖，命令行优先级更高。
var explicitUrls = builder.Configuration["urls"]
    ?? Environment.GetEnvironmentVariable("ASPNETCORE_URLS")
    ?? Environment.GetEnvironmentVariable("DOTNET_URLS");
if (string.IsNullOrWhiteSpace(explicitUrls))
{
    var host = builder.Configuration["Server:Host"];
    var port = builder.Configuration.GetValue("Server:Port", 5080);
    builder.WebHost.UseUrls($"http://{(string.IsNullOrWhiteSpace(host) ? "127.0.0.1" : host)}:{port}");
}

var connectionString = builder.Configuration.GetConnectionString("Db") ?? "Data Source=sp.db";
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlite(connectionString));
builder.Services.AddScoped<CreditService>();
builder.Services.AddScoped<AdminAuth>();
builder.Services.AddScoped<AdminAccounts>();
builder.Services.AddScoped<UserAuth>();
builder.Services.AddScoped<MemberAdmin>();
builder.Services.AddScoped<ConversationStore>();
builder.Services.AddScoped<ServerConfig>();
builder.Services.AddScoped<EmailSender>();
builder.Services.AddScoped<EmailVerification>();
builder.Services.AddScoped<ProviderKey>();
builder.Services.AddScoped<ModelGateway>();
builder.Services.AddScoped<SpeechGateway>();
builder.Services.AddScoped<PaymentService>();
builder.Services.AddHttpClient("upstream", client => client.Timeout = TimeSpan.FromMinutes(5));
builder.Services.AddHttpClient("payments", client => client.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddControllers();
builder.Services.AddSingleton<ServerRuntime>();

// Swagger / OpenAPI：本地联调时打开 /swagger 即可浏览全部接口
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "SP Server API",
        Version = "v1",
        Description = "SP 助手的服务器接口文档",
    });

    // 把控制器/方法的 XML 注释带入文档
    var xmlFile = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    if (File.Exists(xmlPath)) c.IncludeXmlComments(xmlPath);
});

// 允许来源与 SMTP 都存在服务器配置里，后台改完即时生效；留空来源时沿用放开策略
builder.Services.AddScoped<Microsoft.AspNetCore.Cors.Infrastructure.ICorsPolicyProvider,
    ServerCorsPolicyProvider>();
builder.Services.AddCors();

var app = builder.Build();
var logger = app.Logger;
app.UseCors();

// Swagger UI：Development 默认开启；生产环境可在 appsettings 设 Swagger:Enabled 显式开启
var swaggerEnabled = app.Environment.IsDevelopment()
    || builder.Configuration.GetValue("Swagger:Enabled", false);
if (swaggerEnabled)
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "SP Server API v1");
        c.RoutePrefix = "swagger";
    });
}

// 数据库建表、补列、播种与初始管理员统一交给 DatabaseInitializer 处理
await DatabaseInitializer.InitializeAsync(app.Services, app.Logger);

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (ApiException ex)
    {
        context.Response.StatusCode = ex.StatusCode;
        await context.Response.WriteAsJsonAsync(new { code = ex.Code, message = ex.Message });
    }
});

// 所有 HTTP 接口按业务域拆分到 Controllers/，Program.cs 只保留启动与管道配置
app.MapControllers();

var adminIndex = Path.Combine(
    app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot"),
    "admin", "index.html");
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallback(async (HttpContext context) =>
{
    if (!context.Request.Path.StartsWithSegments("/admin") || !File.Exists(adminIndex))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(adminIndex);
});

app.Run();
