// 面板进程/文档存活时间 + 会话列表顺序：判断测试期间是否发生过重载
import fs from 'node:fs/promises';
const DEBUG = 'http://127.0.0.1:9333';
class S {
  constructor(u) { this.ws = new WebSocket(u); this.n = 0; this.p = new Map();
    this.ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { this.p.get(d.id)(d); this.p.delete(d.id); } }); }
  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(m, p) { const id = ++this.n; this.ws.send(JSON.stringify({ id, method: m, params: p || {} })); return new Promise((r) => this.p.set(id, r)); }
  async ev(x) { const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value ?? (r.result?.exceptionDetails ? { __e: r.result.exceptionDetails.text } : null); }
}
const expr = `(() => ({
  uptimeSeconds: Math.round(performance.now() / 1000),
  activeId: state.activeId,
  busy: state.busy,
  status: document.querySelector('#status').textContent,
  model: state.model,
  sessionOrder: state.sessions.map((s) => s.id.slice(0, 8) + '/' + s.title + '/' + s.messages.length + '/' + new Date(s.updatedAt).toISOString()),
  storageOrder: null,
  domBoxes: [...document.querySelectorAll('#thread .msg')].map((b) => b.className + '|' + (b.textContent || '').slice(0, 24)),
  updatedAt: new Date(activeSession().updatedAt).toISOString()
}))()`;
const out = [];
for (const t of (await (await fetch(`${DEBUG}/json`)).json()).filter((x) => /sidepanel\.html/.test(x.url))) {
  const s = new S(t.webSocketDebuggerUrl); await s.open();
  await s.send('Runtime.enable').catch(() => null);
  const w = await s.ev('innerWidth');
  const data = w < 600 ? await s.ev(expr) : null;
  const stored = w < 600 ? await s.ev(`chrome.storage.local.get('sessions').then((v) => (v.sessions || []).map((s) => s.id.slice(0, 8) + '/' + s.title + '/' + s.messages.length + '/' + ((s.messages.at(-1) && s.messages.at(-1).reasoning) ? 'R' + s.messages.at(-1).reasoning.length : '-')).join(' | '))`) : null;
  out.push({ id: t.id, innerW: w, data, stored });
  s.ws.close();
}
await fs.writeFile('panel-uptime.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written');
