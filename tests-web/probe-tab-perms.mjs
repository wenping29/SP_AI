import http from "node:http";

const PORT = 9333;
const FIXTURE_PORT = 5199;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const findPanel = async () => (await list()).find((t) => t.type === "page" && /sidepanel\/sidepanel\.html(?!\?full=1)/.test(t.url || ""));
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
  if (r.exceptionDetails) return "EVALERR " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const openSession = async (t) => {
  const s = await connect(t);
  await s.send("Page.enable");
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  return s;
};
const fixture = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>读取测试页</title></head><body><h1>读取测试页</h1><p>这是一段用于验证全页模式读取正文的测试文字，长度足够被正文提取器识别。</p></body></html>`);
});
await new Promise((r) => fixture.listen(FIXTURE_PORT, "127.0.0.1", r));
const panel = await openSession(await findPanel());
const created = [];
const report = {};
try {
  const fixtureTab = await ev(panel, `chrome.tabs.create({ url: "http://127.0.0.1:${FIXTURE_PORT}/", active: true }).then((t) => ({ id: t.id, windowId: t.windowId }))`);
  created.push(fixtureTab.id);
  report.fixture = fixtureTab;
  await sleep(1600);
  report.permissions = await ev(panel, `chrome.permissions.getAll().then((p) => ({ permissions: p.permissions, origins: p.origins }))`);
  report.activeQuery = await ev(panel, `chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => t && ({ id: t.id, windowId: t.windowId, url: t.url, title: t.title, active: t.active }))`);
  report.getFixture = await ev(panel, `chrome.tabs.get(${fixtureTab.id}).then((t) => ({ url: t.url, title: t.title, active: t.active }))`);
  report.inject = await ev(panel, `chrome.scripting.executeScript({ target: { tabId: ${fixtureTab.id} }, func: () => document.title }).then((r) => r[0] && r[0].result)`);
  report.extract = await ev(panel, `chrome.tabs.sendMessage(${fixtureTab.id}, { type: "extract" }).then((p) => p && { url: p.url, chars: (p.text || "").length }).catch((e) => "MSGERR " + e.message)`);
} finally {
  if (created.length) await ev(panel, `chrome.tabs.remove(${JSON.stringify(created)})`).catch(() => {});
  panel.close();
  fixture.close();
}
console.log(JSON.stringify(report, null, 2));
process.exit(0);
