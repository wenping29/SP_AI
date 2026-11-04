const PORT = 9333;
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (await list()).find((x) => x.type === "page" && /sidepanel\/sidepanel\.html(?!\?full=1)/.test(x.url || ""));
if (!t) {
  console.log("no panel target");
  process.exit(0);
}
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id;
  pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
await ev(`showView("settings")`);
await ev(`els.serverInput.value = "http://127.0.0.1:5080"`);
await ev(`els.saveSettings.click()`);
for (let i = 0; i < 40; i++) {
  await sleep(250);
  const status = await ev(`document.getElementById("status").textContent`);
  if (status && status !== "保存中…" && !/连不上|失败/.test(status)) {
    if (status === "已保存设置" || status === "已连接") break;
  }
}
await sleep(800);
console.log(JSON.stringify(await ev(`({
  server: state.server,
  status: document.getElementById("status").textContent,
  balance: state.balance,
  token: Boolean(state.token),
  models: (state.config?.models || []).map((m) => m.modelId),
  view: state.view,
})`), null, 2));
ws.close();
process.exit(0);
