import fs from "node:fs/promises";
const PORT = 9333;
const EXT = "jmgfklbjklbemmocojbpaajjpbobankp";
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    ws.onopen = () => resolve({
      send: (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      close: () => ws.close(),
    });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onerror = () => reject(new Error("ws"));
  });
}
const findPanel = async () => (await list()).find((t) => t.type === "page" && /sidepanel\/sidepanel\.html/.test(t.url || ""));
const ev = async (s, expression) => {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "failed");
  return r.result.value;
};
const waitFor = async (s, expression, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(s, expression).catch(() => false)) return true; await sleep(200); }
  return false;
};
const openSession = async (t) => {
  const s = await connect(t);
  await s.send("Page.enable");
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  return s;
};
const shot = async (s, file) => { const d = await s.send("Page.captureScreenshot", { format: "png" }); await fs.writeFile(file, Buffer.from(d.data, "base64")); };

let s = await openSession(await findPanel());
await s.send("Page.navigate", { url: `chrome-extension://${EXT}/sidepanel/sidepanel.html?v=${Date.now()}` });
s.close();
await sleep(1200);
s = await openSession(await findPanel());
const fresh = await waitFor(s, `!!document.getElementById("navToggle") && [...document.styleSheets].some((x) => { try { return [...x.cssRules].some((r) => (r.selectorText || "").includes(".nav-menu")); } catch { return false; } })`);

const report = { fresh };
report.initial = await ev(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  railDisplay: getComputedStyle(document.getElementById("rail")).display,
  barDisplay: getComputedStyle(document.querySelector(".collapsed-bar")).display,
  menuHidden: document.getElementById("navMenu").hidden,
  activeView: document.querySelector("#rail button[data-view].active")?.dataset.view,
  navActive: [...document.querySelectorAll("#navGrid .nav-item.active")].map((b) => b.dataset.view),
})`);

// 折叠
await ev(s, `document.getElementById("railFold").click()`);
await sleep(250);
report.collapsed = await ev(s, `(() => { const t = document.getElementById("navToggle").getBoundingClientRect(); return {
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  railDisplay: getComputedStyle(document.getElementById("rail")).display,
  barDisplay: getComputedStyle(document.querySelector(".collapsed-bar")).display,
  menuHidden: document.getElementById("navMenu").hidden,
  toggle: { x: Math.round(t.left), y: Math.round(t.top), w: Math.round(t.width), h: Math.round(t.height) },
  mainVisible: getComputedStyle(document.querySelector(".chat-view")).display !== "none",
  stored: null,
}; })()`);
report.collapsed.stored = await ev(s, `chrome.storage.local.get("panelCollapsed").then((v) => v.panelCollapsed)`);
await shot(s, "nav-collapsed.png");

// 打开汉堡卡片
await ev(s, `document.getElementById("navToggle").click()`);
await sleep(250);
report.menuOpen = await ev(s, `(() => { const m = document.getElementById("navMenu"), r = m.getBoundingClientRect(); return {
  hidden: m.hidden,
  expanded: document.getElementById("navToggle").getAttribute("aria-expanded"),
  box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
  inViewport: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
  items: [...document.querySelectorAll("#navGrid .nav-item")].map((b) => ({ view: b.dataset.view, label: b.textContent.trim(), active: b.classList.contains("active") })),
  topButtons: [...document.querySelectorAll(".nav-menu-top button")].map((b) => b.id),
  footButtons: [...document.querySelectorAll(".nav-menu-foot button")].map((b) => b.id),
}; })()`);
await shot(s, "nav-menu-open.png");

// 选一个视图：菜单关闭、仍是折叠态
await ev(s, `document.querySelector('#navGrid .nav-item[data-view="tools"]').click()`);
await sleep(250);
report.pickTools = await ev(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  menuHidden: document.getElementById("navMenu").hidden,
  activeView: document.querySelector("#rail button[data-view].active")?.dataset.view,
  toolsVisible: !document.getElementById("toolsView").hidden,
})`);

// 空白处点击关闭菜单
await ev(s, `document.getElementById("navToggle").click()`);
await sleep(150);
await ev(s, `document.getElementById("thread").dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
await sleep(150);
report.outsideClick = await ev(s, `({ menuHidden: document.getElementById("navMenu").hidden, expanded: document.getElementById("navToggle").getAttribute("aria-expanded") })`);

// 展开回功能栏
await ev(s, `document.getElementById("navToggle").click()`);
await sleep(120);
await ev(s, `document.getElementById("navExpand").click()`);
await sleep(250);
report.expand = await ev(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  railDisplay: getComputedStyle(document.getElementById("rail")).display,
  menuHidden: document.getElementById("navMenu").hidden,
  stored: null,
})`);
report.expand.stored = await ev(s, `chrome.storage.local.get("panelCollapsed").then((v) => v.panelCollapsed)`);

// 全页入口（从汉堡卡片）：先在点击前锁定面板 target，避免新标签被当成面板排除
const panelId = (await findPanel()).id;
const before = new Set((await list()).map((t) => t.id));
await ev(s, `document.getElementById("railFold").click()`);
await sleep(200);
await ev(s, `document.getElementById("navToggle").click()`);
await sleep(150);
await ev(s, `document.getElementById("navFull").click()`);
let fullTarget = null;
for (let i = 0; i < 30 && !fullTarget; i++) {
  await sleep(200);
  fullTarget = (await list()).find((t) => t.id !== panelId && !before.has(t.id) && /sidepanel\.html\?full=1/.test(t.url || ""));
}
report.fullFromMenu = fullTarget ? { url: fullTarget.url.split("sidepanel.html")[1] } : { error: "no new full tab" };
if (fullTarget) await fetch(`http://127.0.0.1:${PORT}/json/close/${fullTarget.id}`);

// 收尾：回功能栏 + 聊天，菜单关闭
await ev(s, `setCollapsed(false); closeNavMenu(); showView("chat")`);
await sleep(200);
report.final = await ev(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  menuHidden: document.getElementById("navMenu").hidden,
  activeView: document.querySelector("#rail button[data-view].active")?.dataset.view,
  stored: null,
})`);
report.final.stored = await ev(s, `chrome.storage.local.get("panelCollapsed").then((v) => v.panelCollapsed)`);

console.log(JSON.stringify(report, null, 2));
s.close();
