namespace SpServer.Domain;

public class Account
{
    public int Id { get; set; }
    public string DeviceId { get; set; } = "";
    public string Token { get; set; } = "";
    public string Label { get; set; } = "";
    public int Balance { get; set; }
    public bool IsBlocked { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime LastUsedAt { get; set; }
}

public class CreditTransaction
{
    public int Id { get; set; }
    public int AccountId { get; set; }
    public int Delta { get; set; }
    public string Reason { get; set; } = "";
    public string ModelId { get; set; } = "";
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class ModelSpec
{
    public int Id { get; set; }
    public string ModelId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Provider { get; set; } = "";
    public string UpstreamModel { get; set; } = "";
    public int InputRatePer1K { get; set; }
    public int OutputRatePer1K { get; set; }
    public int MaxContextChars { get; set; } = 12000;
    public bool SupportsVision { get; set; }
    public bool IsEnabled { get; set; } = true;
    public int SortOrder { get; set; }
    public string Note { get; set; } = "";
}

public class CreditPolicy
{
    public int Id { get; set; } = 1;
    public int FreeCredits { get; set; } = 1000;
    public bool ChatEnabled { get; set; } = true;
    public string Notice { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}
