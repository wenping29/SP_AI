// 读取面板里最后一条 assistant 消息的完整字段，用来判定是哪条代码路径写入的
import fs from 'node:fs/promises';
const DEBUG = 'http://127.0.0.1:9333';
class S {
  constructor(u) { this.ws = new WebSocket(u); this.n = 0; this.p = new Map();
    this.ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { this.p.get(d.id)(d); this.p.delete(d.id); } }); }
  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(m, p) { const id = ++this.n; this.ws.send(JSON.stringify({ id, method: m, params: p || {} })); return new Promise((r) => this.p.set(id, r)); }
  async ev(x) { const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __e: r.result.exceptionDetails.text };
    return r.result?.result?.value ?? null; }
}
const expr = `(() => {
  const s = activeSession();
  return { title: s.title, activeId: state.activeId, busy: state.busy,
    status: document.querySelector('#status').textContent,
    sessions: state.sessions.map((x) => ({ id: x.id, title: x.title, n: x.messages.length, roles: x.messages.map((m) => m.role + ':' + (m.content || '').length + ':' + (m.reasoning || '').length) })),
    last: (() => { const m = s.messages.at(-1); if (!m) return null; const o = {}; for (const k of Object.keys(m)) o[k] = typeof m[k] === 'string' ? m[k].slice(0, 40) : m[k]; return o; })(),
    boxes: [...document.querySelectorAll('#thread .msg.assistant')].map((b) => ({ cls: b.className, r: b.querySelector('.reasoning-body')?.textContent.length || 0, sum: b.querySelector('.reasoning summary')?.textContent || null, body: (b.querySelector('.msg-body')?.textContent || '').slice(0, 30), meta: b.querySelector('.meta')?.textContent || null })),
    storageTitles: null };
})()`;
const out = [];
for (const t of (await (await fetch(`${DEBUG}/json`)).json()).filter((x) => /sidepanel\.html/.test(x.url))) {
  const s = new S(t.webSocketDebuggerUrl); await s.open();
  await s.send('Runtime.enable').catch(() => null);
  const w = await s.ev('innerWidth');
  out.push({ id: t.id, innerW: w, data: w < 600 ? await s.ev(expr) : null });
  s.ws.close();
}
await fs.writeFile('msg-inspect.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written');
