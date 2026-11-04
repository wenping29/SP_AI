const PORT = 9333;
const EXT = "jmgfklbjklbemmocojbpaajjpbobankp";
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close(),
    });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onerror = () => reject(new Error("ws"));
  });
}
const findPanel = async () => (await list()).find((t) => t.type === "page" && /sidepanel\/sidepanel\.html/.test(t.url || ""));
const ev = async (s, expression) => {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "failed");
  return r.result.value;
};
const waitFor = async (s, expression, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(s, expression).catch(() => false)) return true; await sleep(120); }
  return false;
};

let s = await connect(await findPanel());
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

// 先人为把折叠状态写进 storage，再重载面板，模拟“重开面板”
await ev(s, `chrome.storage.local.set({ panelCollapsed: true })`);
await s.send("Page.navigate", { url: `chrome-extension://${EXT}/sidepanel/sidepanel.html?v=${Date.now()}` });
s.close();
await sleep(1500);
s = await connect(await findPanel());
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
const ready = await waitFor(s, `!!document.getElementById("railFold")`);
const restored = await ev(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  hintDisplay: getComputedStyle(document.querySelector(".collapsed-hint")).display,
  hintText: document.querySelector(".collapsed-hint span").textContent,
  foldTip: document.getElementById("railFold").dataset.tip,
})`);

// 折叠状态下点「聊天」图标应展开并保持该视图
await ev(s, `document.querySelector('.rail button[data-view="chat"]').click()`);
await sleep(200);
const afterIconClick = await ev(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  mainDisplay: getComputedStyle(document.querySelector(".main")).display,
  stored: null,
})`);
afterIconClick.stored = await ev(s, `chrome.storage.local.get("panelCollapsed").then((v) => v.panelCollapsed)`);

console.log(JSON.stringify({ ready, restored, afterIconClick }, null, 2));
s.close();
