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

const report = {};
const created = [];
const panel = await openSession(await findPanel());
async function openFull() {
  const id = await ev(panel, `chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/sidepanel.html?full=1&v=" + Date.now()), active: true }).then((t) => t.id)`);
  created.push(id);
  await sleep(2200);
  const target = (await list()).find((t) => /sidepanel\.html\?full=1/.test(t.url || ""));
  if (!target) throw new Error("full tab target missing");
  const s = await openSession(target);
  for (let i = 0; i < 25; i++) {
    if (await ev(s, `typeof extractPage === "function"`).catch(() => false)) break;
    await sleep(200);
  }
  return s;
}
try {
  // 1) 有权限的网页（cn.bing.com）→ 全页模式应能回退读取
  created.push(await ev(panel, `chrome.tabs.create({ url: "https://cn.bing.com/", active: true }).then((t) => t.id)`));
  await sleep(4000);
  let full = await openFull();
  report.bing = await ev(full, `Promise.race([extractPage().then((p) => ({ url: p.url, chars: (p.text || "").length })).catch((e) => "ERR " + e.message), new Promise((r) => setTimeout(() => r("TIMEOUT"), 15000))])`);
  full.close();

  // 2) 无权限的网页（127.0.0.1）→ 给出权限提示
  created.push(await ev(panel, `chrome.tabs.create({ url: "http://127.0.0.1:${FIXTURE_PORT}/", active: true }).then((t) => t.id)`));
  await sleep(1500);
  full = await openFull();
  report.noPermission = await ev(full, `Promise.race([extractPage().then((p) => ({ url: p.url, chars: (p.text || "").length })).catch((e) => "ERR " + e.message), new Promise((r) => setTimeout(() => r("TIMEOUT"), 15000))])`);
  full.close();
} finally {
  if (created.length) await ev(panel, `chrome.tabs.remove(${JSON.stringify(created)})`).catch(() => {});
  panel.close();
  fixture.close();
}
console.log(JSON.stringify(report, null, 2));
process.exit(0);
