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

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<ProviderCredential>().HasKey(c => c.Provider);
        model.Entity<Account>().HasIndex(a => a.DeviceId).IsUnique();
        model.Entity<Account>().HasIndex(a => a.Token).IsUnique();
        model.Entity<ModelSpec>().HasIndex(m => m.ModelId).IsUnique();
        model.Entity<CreditTransaction>().HasIndex(t => t.AccountId);
    }

    public async Task SeedAsync(CancellationToken ct = default)
    {
        if (!await Policies.AnyAsync(ct))
        {
            Policies.Add(new CreditPolicy { Id = 1, FreeCredits = 1000, UpdatedAt = DateTime.UtcNow });
        }

        // 模型 ID 与扣分系数以各平台控制台实际值为准，后台 /api/admin/models 可改
        var seeds = new List<ModelSpec>
        {
            new() { ModelId = "glm-4-flash", DisplayName = "智谱 GLM-4-Flash（免费档）", Provider = "zhipu",
                    UpstreamModel = "glm-4-flash", InputRatePer1K = 1, OutputRatePer1K = 2, SortOrder = 1,
                    Note = "官方永久免费，仅限速" },
            new() { ModelId = "glm-5.3-flash", DisplayName = "智谱 GLM-5.3-Flash", Provider = "zhipu",
                    UpstreamModel = "glm-5.3-flash", InputRatePer1K = 4, OutputRatePer1K = 10, SortOrder = 2 },
            new() { ModelId = "deepseek-chat", DisplayName = "DeepSeek V3", Provider = "deepseek",
                    UpstreamModel = "deepseek-chat", InputRatePer1K = 2, OutputRatePer1K = 6, SortOrder = 3 },
            new() { ModelId = "deepseek-reasoner", DisplayName = "DeepSeek R1（思考模型）", Provider = "deepseek",
                    UpstreamModel = "deepseek-reasoner", InputRatePer1K = 4, OutputRatePer1K = 16, SortOrder = 8,
                    Note = "带思考过程，可随时终止思考" },
            new() { ModelId = "qwen-plus", DisplayName = "通义千问 Plus", Provider = "dashscope",
                    UpstreamModel = "qwen-plus", InputRatePer1K = 3, OutputRatePer1K = 8, SortOrder = 4 },
            new() { ModelId = "ernie-speed", DisplayName = "文心 ERNIE Speed（免费档）", Provider = "qianfan",
                    UpstreamModel = "ernie-speed-128k", InputRatePer1K = 1, OutputRatePer1K = 2, SortOrder = 5,
                    Note = "模型 ID 需在千帆控制台核对" },
            new() { ModelId = "deepseek-v3-sf", DisplayName = "DeepSeek V3（硅基流动）", Provider = "siliconflow",
                    UpstreamModel = "deepseek-ai/DeepSeek-V3", InputRatePer1K = 2, OutputRatePer1K = 5,
                    SortOrder = 6, IsEnabled = false, SupportsVision = false },
            new() { ModelId = "glm-4v-flash", DisplayName = "智谱 GLM-4V-Flash（视觉免费档）", Provider = "zhipu",
                    UpstreamModel = "glm-4v-flash", InputRatePer1K = 1, OutputRatePer1K = 2, SortOrder = 7,
                    SupportsVision = true, Note = "支持截图与图片问答，官方免费" },
            new() { ModelId = "deepseek-v4-pro", DisplayName = "DeepSeek V4 Pro", Provider = "deepseek",
                    UpstreamModel = "deepseek-v4-pro", InputRatePer1K = 4, OutputRatePer1K = 16, SortOrder = 9,
                    Note = "费率可按后台实际计费调整" },
        };

        foreach (var seed in seeds)
        {
            if (!await Models.AnyAsync(m => m.ModelId == seed.ModelId, ct)) Models.Add(seed);
        }

        await SaveChangesAsync(ct);
    }
}
