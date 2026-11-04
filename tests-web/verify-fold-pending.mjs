const PORT = 9333;
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
const ev = async (s, expression) => {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "failed");
  return r.result.value;
};
const panel = (await list()).find((t) => t.type === "page" && /sidepanel\/sidepanel\.html/.test(t.url || ""));
const s = await connect(panel);
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
const result = await ev(s, `(async () => {
  setCollapsed(true);
  await chrome.storage.local.set({ pending: { actionId: null, view: "translate", selection: "", title: "", url: "", windowId: null, at: Date.now() } });
  await consumePending();
  await new Promise((r) => setTimeout(r, 200));
  return {
    collapsed: document.querySelector(".layout").classList.contains("collapsed"),
    viewActive: document.querySelector('.rail button[data-view].active')?.dataset.view,
    pendingLeft: await chrome.storage.local.get("pending").then((v) => v.pending),
    stored: await chrome.storage.local.get("panelCollapsed").then((v) => v.panelCollapsed),
  };
})()`);
console.log(JSON.stringify(result, null, 2));
s.close();
