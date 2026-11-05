namespace SpServer.Application;

public static class PromptTemplates
{
    public const string DefaultSystem =
        "你是一个中文 AI 助手，回答一律使用简体中文，结论先行、要点分明，不要复述用户给定的原文。";

    public static readonly object[] Actions =
    [
        new
        {
            id = "summarize",
            label = "总结全文",
            icon = "summary",
            prompt = "请用中文提炼下面网页的核心内容：先用一句话给结论，再列 3 到 6 条要点（每条不超过 40 字），" +
                     "最后说明这份材料适合谁读。原文：\n\n{{page}}",
        },
        new
        {
            id = "outline",
            label = "分段大纲",
            icon = "outline",
            prompt = "请把下面的网页整理成中文分层大纲，最多三级，保留关键数据和结论，不要加入原文没有的信息。原文：\n\n{{page}}",
        },
        new
        {
            id = "translate",
            label = "译成中文",
            icon = "translate",
            prompt = "请把下面内容翻译成通顺自然的中文，专有名词首次出现时在括号里保留英文。原文：\n\n{{selection}}",
        },
        new
        {
            id = "translate-en",
            label = "译成英文",
            icon = "translate",
            prompt = "请把下面内容翻译成自然、地道的英文，保持原有语气和信息密度，只输出译文。原文：\n\n{{selection}}",
        },
        new
        {
            id = "explain",
            label = "解释划线",
            icon = "explain",
            prompt = "请用中文解释下面这段内容在说什么，先给一句话定义，再补充必要背景和举例。原文：\n\n{{selection}}",
        },
        new
        {
            id = "polish",
            label = "润色改写",
            icon = "polish",
            prompt = "请润色下面的中文表达，使其更简洁专业，输出改写后的版本，并在下面用一行说明主要改动。原文：\n\n{{selection}}",
        },
        new
        {
            id = "qa_page",
            label = "问这篇网页",
            icon = "question",
            prompt = "请只依据下面网页内容回答问题，找不到答案时明确说“文中未提及”。\n\n网页内容：\n{{page}}\n\n问题：{{question}}",
        },
    ];
}
