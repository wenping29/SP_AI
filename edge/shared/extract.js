// 注入到页面隔离环境，内容脚本与 chrome.scripting.executeScript 共用。
function spExtract() {
  const REMOVE = "script,style,noscript,template,svg,canvas,nav,footer,header,aside,form,iframe,ins," +
    "[role=banner],[role=navigation],[role=contentinfo],[aria-hidden=true],.ad,.ads,.sidebar,.comment,.comments";

  const CANDIDATES = [
    "article",
    "[role=main]",
    "main",
    "#article-body",
    "#content",
    ".article-content",
    ".post-content",
    ".markdown-body",
    ".content",
  ];

  function textOf(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(REMOVE).forEach((node) => node.remove());
    const raw = clone.innerText || clone.textContent || "";
    return raw.replace(/[ \t\u00a0]+/g, " ").replace(/\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  let best = "";
  for (const selector of CANDIDATES) {
    for (const el of document.querySelectorAll(selector)) {
      const text = textOf(el);
      if (text.length > best.length) best = text;
    }
    if (best.length > 1500) break;
  }

  const body = textOf(document.body);
  const text = best.length > body.length * 0.5 ? best : body;
  const MAX_CHARS = 40000;

  return {
    title: document.title || "",
    url: location.href,
    text: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text,
    truncated: text.length > MAX_CHARS,
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.spExtract = spExtract;
}
