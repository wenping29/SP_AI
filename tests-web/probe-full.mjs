const list = async () => (await (await fetch("http://127.0.0.1:9333/json/list")).json());
const ext = "jmgfklbjklbemmocojbpaajjpbobankp";
const targets = await list();
const panel = targets.find((t) => t.type === "page" && /sidepanel\.html/.test(t.url || ""));
const ws = new WebSocket(panel.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value;
};
const tab = await ev(`chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/sidepanel.html?full=1&v=" + Date.now()) }).then((t) => ({ id: t.id, url: t.url }))`);
console.log("opened", tab);
await new Promise((r) => setTimeout(r, 1800));
console.log("htmlHasDataset line:", await ev(`fetch(chrome.runtime.getURL("sidepanel/sidepanel.html")).then((r) => r.text()).then((t) => ({ hasLine: t.includes("dataset.full"), head: t.slice(0, 420) }))`));
const t2 = (await list()).find((t) => /sidepanel\.html\?full=1/.test(t.url || ""));
console.log("full target:", t2?.id, t2?.url);
if (t2) {
  const ws2 = new WebSocket(t2.webSocketDebuggerUrl);
  await new Promise((r) => ws2.addEventListener("open", r, { once: true }));
  const p2 = new Map(); let i2 = 0;
  ws2.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p2.has(m.id)) { p2.get(m.id)(m.result); p2.delete(m.id); } };
  const s2 = (method, params = {}) => new Promise((res) => { const i = ++i2; p2.set(i, res); ws2.send(JSON.stringify({ id: i, method, params })); });
  const r = await s2("Runtime.evaluate", { expression: `({ search: location.search, dataset: JSON.stringify(document.documentElement.dataset), ready: document.readyState, outer: document.documentElement.outerHTML.slice(0, 600) })`, returnByValue: true });
  console.log(JSON.stringify(r.result.value, null, 2));
  console.log("close:", await fetch(`http://127.0.0.1:9333/json/close/${t2.id}`).then((r) => r.status));
  ws2.close();
}
ws.close();
