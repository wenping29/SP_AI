const PORT = 9333;
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = (await list()).find((t) => t.type === "page" && /sidepanel\/sidepanel\.html/.test(t.url || ""));
const ws = new WebSocket(p.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const send = (m, pr = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: pr })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
const before = new Set((await list()).map((t) => t.id));
const res = await ev(`(async () => {
  setCollapsed(true);
  openNavMenu();
  await new Promise((r) => setTimeout(r, 100));
  document.getElementById("navFull").click();
  await new Promise((r) => setTimeout(r, 1200));
  return {
    menuHidden: document.getElementById("navMenu").hidden,
    status: document.getElementById("status").textContent,
    collapsed: document.querySelector(".layout").classList.contains("collapsed"),
    tabs: await chrome.tabs.query({ currentWindow: true }).then((ts) => ts.filter((t) => (t.url || "").includes("full=1")).map((t) => ({ id: t.id, url: t.url }))),
  };
})()`);
console.log("click:", JSON.stringify(res, null, 2));
const after = await list();
console.log("new targets:", after.filter((t) => !before.has(t.id)).map((t) => ({ id: t.id.slice(0, 8), url: t.url })));
for (const t of after) if (/full=1/.test(t.url || "")) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
await ev(`setCollapsed(false); closeNavMenu(); showView("chat")`);
ws.close();
