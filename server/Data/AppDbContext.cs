using Microsoft.EntityFrameworkCore;
using SpServer.Domain;

namespace SpServer.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<CreditTransaction> Transactions => Set<CreditTransaction>();
    public DbSet<ModelSpec> Models => Set<ModelSpec>();
    public DbSet<CreditPolicy> Policies => Set<CreditPolicy>();
    public DbSet<ProviderCredential> ProviderCredentials => Set<ProviderCredential>();
    public DbSet<KeyEnvEntry> KeyEnvs => Set<KeyEnvEntry>();
    public DbSet<AdminUser> AdminUsers => Set<AdminUser>();
    public DbSet<AdminRole> AdminRoles => Set<AdminRole>();
    public DbSet<AdminSession> AdminSessions => Set<AdminSession>();
    public DbSet<User> Users => Set<User>();
    public DbSet<DeviceSession> DeviceSessions => Set<DeviceSession>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<EmailCode> EmailCodes => Set<EmailCode>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<ProviderCredential>().HasKey(c => c.Provider);
        model.Entity<Account>().HasIndex(a => a.DeviceId).IsUnique();
        model.Entity<Account>().HasIndex(a => a.Token).IsUnique();
        model.Entity<ModelSpec>().HasIndex(m => m.ModelId).IsUnique();
        model.Entity<CreditTransaction>().HasIndex(t => t.AccountId);
        model.Entity<AdminUser>().HasIndex(u => u.Username).IsUnique();
        model.Entity<AdminRole>().HasIndex(r => r.Name).IsUnique();
        model.Entity<AdminSession>().HasIndex(s => s.TokenHash).IsUnique();
        model.Entity<AdminSession>().HasIndex(s => s.UserId);
        model.Entity<AdminSession>().HasIndex(s => s.ExpiresAt);
        model.Entity<Account>().HasIndex(a => a.UserId);
        model.Entity<User>().HasIndex(u => u.Email).IsUnique();
        model.Entity<DeviceSession>().HasIndex(s => s.Token).IsUnique();
        model.Entity<DeviceSession>().HasIndex(s => s.DeviceId).IsUnique();
        model.Entity<DeviceSession>().HasIndex(s => s.AccountId);
        model.Entity<Conversation>().HasIndex(c => new { c.UserId, c.ClientId }).IsUnique();
        model.Entity<Conversation>().HasIndex(c => new { c.UserId, c.UpdatedAt });
        model.Entity<EmailCode>().HasIndex(c => c.Email);
        model.Entity<EmailCode>().HasIndex(c => c.CreatedAt);
    }

    public async Task SeedAsync(CancellationToken ct = default)
    {
        if (!await Policies.AnyAsync(ct))
        {
            Policies.Add(new CreditPolicy { Id = 1, FreeCredits = 1000, UpdatedAt = DateTime.UtcNow });
        }

        // 内置角色：超级管理员不可删除/改权限；运营与只读可改，也可另建角色
        if (!await AdminRoles.AnyAsync(ct))
        {
            var now = DateTime.UtcNow;
            AdminRoles.AddRange(
                new AdminRole
                {
                    Name = "超级管理员",
                    Description = "拥有全部模块权限，系统内置",
                    Permissions = """["*"]""",
                    IsSystem = true,
                    CreatedAt = now,
                    UpdatedAt = now,
                },
                new AdminRole
                {
                    Name = "运营",
                    Description = "设备、模型、策略与 KeyEnv 的日常运营",
                    Permissions = """
                        ["dashboard.view","devices.view","devices.manage","models.view","models.manage","policy.view","policy.manage","keyenvs.view","keyenvs.manage"]
                        """,
                    CreatedAt = now,
                    UpdatedAt = now,
                },
                new AdminRole
                {
                    Name = "只读",
                    Description = "只能查看运营数据，不能修改",
                    Permissions = """
                        ["dashboard.view","devices.view","models.view","policy.view","keyenvs.view"]
                        """,
                    CreatedAt = now,
                    UpdatedAt = now,
                });
        }

        // 模型 ID 与扣分系数以各平台控制台实际值为准，后台 /api/admin/models 可改
        var seeds = new List<ModelSpec>
        {
            new() { ModelId = "glm-4-flash", DisplayName = "智谱 GLM-4-Flash（免费档）", Provider = "zhipu",
                    UpstreamModel = "glm-4-flash", InputRatePer1K = 1, OutputRatePer1K = 2, SortOrder = 1,
                    Category = "高性价比", Note = "官方永久免费，仅限速" },
            new() { ModelId = "glm-5.3-flash", DisplayName = "智谱 GLM-5.3-Flash", Provider = "zhipu",
                    UpstreamModel = "glm-5.3-flash", InputRatePer1K = 4, OutputRatePer1K = 10, SortOrder = 2,
                    Category = "高性价比" },
            new() { ModelId = "deepseek-chat", DisplayName = "DeepSeek V3", Provider = "deepseek",
                    UpstreamModel = "deepseek-chat", InputRatePer1K = 2, OutputRatePer1K = 6, SortOrder = 3,
                    Category = "高性价比" },
            new() { ModelId = "deepseek-reasoner", DisplayName = "DeepSeek R1（思考模型）", Provider = "deepseek",
                    UpstreamModel = "deepseek-reasoner", InputRatePer1K = 4, OutputRatePer1K = 16, SortOrder = 8,
                    Category = "最智能", Note = "带思考过程，可随时终止思考" },
            new() { ModelId = "qwen-plus", DisplayName = "通义千问 Plus", Provider = "dashscope",
                    UpstreamModel = "qwen-plus", InputRatePer1K = 3, OutputRatePer1K = 8, SortOrder = 4,
                    Category = "高级" },
            new() { ModelId = "ernie-speed", DisplayName = "文心 ERNIE Speed（免费档）", Provider = "qianfan",
                    UpstreamModel = "ernie-speed-128k", InputRatePer1K = 1, OutputRatePer1K = 2, SortOrder = 5,
                    Category = "高性价比", Note = "模型 ID 需在千帆控制台核对" },
            new() { ModelId = "deepseek-v3-sf", DisplayName = "DeepSeek V3（硅基流动）", Provider = "siliconflow",
                    UpstreamModel = "deepseek-ai/DeepSeek-V3", InputRatePer1K = 2, OutputRatePer1K = 5,
                    SortOrder = 6, Category = "高性价比", IsEnabled = false, SupportsVision = false },
            new() { ModelId = "glm-4v-flash", DisplayName = "智谱 GLM-4V-Flash（视觉免费档）", Provider = "zhipu",
                    UpstreamModel = "glm-4v-flash", InputRatePer1K = 1, OutputRatePer1K = 2, SortOrder = 7,
                    Category = "高性价比", SupportsVision = true, Note = "支持截图与图片问答，官方免费" },
            new() { ModelId = "deepseek-v4-pro", DisplayName = "DeepSeek V4 Pro", Provider = "deepseek",
                    UpstreamModel = "deepseek-v4-pro", InputRatePer1K = 4, OutputRatePer1K = 16, SortOrder = 9,
                    Category = "最智能", Note = "费率可按后台实际计费调整" },
        };

        foreach (var seed in seeds)
        {
            if (!await Models.AnyAsync(m => m.ModelId == seed.ModelId, ct)) Models.Add(seed);
        }

        await SaveChangesAsync(ct);
    }
}
