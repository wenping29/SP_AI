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
const probe = await ev(`(async () => {
  setCollapsed(true);
  openNavMenu();
  const before = document.getElementById("navMenu").hidden;
  document.getElementById("navFull").click();
  await new Promise((r) => setTimeout(r, 1200));
  return {
    menuWasOpen: !before,
    menuNowHidden: document.getElementById("navMenu").hidden,
    status: document.getElementById("status").textContent,
    lastError: chrome.runtime.lastError?.message || null,
  };
})()`);
console.log("click navFull:", JSON.stringify(probe));
const direct = await ev(`openFullPage().then((t) => ({ id: t.id, url: t.url })).catch((e) => ({ error: String(e) }))`);
console.log("direct call:", JSON.stringify(direct));
await sleep(600);
const targets = await list();
console.log("full targets:", targets.filter((t) => /full=1/.test(t.url || "")).map((t) => t.id));
for (const t of targets.filter((x) => /full=1/.test(x.url || ""))) await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`);
await ev(`setCollapsed(false); closeNavMenu(); showView("chat")`);
ws.close();
