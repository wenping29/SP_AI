const PORT = 9333;
const EXT = "jmgfklbjklbemmocojbpaajjpbobankp";
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findPanel = async () => (await list()).find((t) => t.type === "page" && /sidepanel\/sidepanel\.html/.test(t.url || ""));
function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0;
    const pend = new Map();
    ws.onopen = () => resolve({
      send: (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      close: () => ws.close(),
    });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onerror = () => reject(new Error("ws"));
  });
}
const ev = async (s, expression) => {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "failed");
  return r.result.value;
};
let s = await connect(await findPanel());
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
await s.send("Page.navigate", { url: `chrome-extension://${EXT}/sidepanel/sidepanel.html?v=${Date.now()}` });
s.close();
await sleep(1500);
s = await connect(await findPanel());
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
for (let i = 0; i < 25; i++) {
  const has = await ev(s, `typeof state !== "undefined" && !!document.getElementById("status")`).catch(() => false);
  if (has) break;
  await sleep(200);
}
await sleep(1500);
const report = await ev(s, `({
  server: state.server,
  token: !!state.token,
  status: document.getElementById("status").textContent,
  kind: document.getElementById("status").className,
  view: state.view,
  navActive: [...document.querySelectorAll("#navGrid .nav-item.active")].map((b) => b.dataset.view),
  toast: document.querySelector(".toast")?.textContent || "",
})`);
console.log(JSON.stringify(report, null, 2));
s.close();
