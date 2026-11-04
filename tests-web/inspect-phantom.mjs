// 取出 9033783f 会话里那条 assistant 消息的全部字段与时间戳，判定写入路径
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
const expr = `(() => {
  const s = state.sessions[0];
  const dump = (m) => { const o = {}; for (const k of Object.keys(m)) { const v = m[k]; o[k] = typeof v === 'string' ? { len: v.length, head: v.slice(0, 50) } : v; }
    if (m.at) o.atIso = new Date(m.at).toISOString(); return o; };
  return { id: s.id.slice(0, 8), title: s.title, updatedAt: new Date(s.updatedAt).toISOString(),
           messages: s.messages.map(dump),
           storageSame: null };
})()`;
const out = [];
for (const t of (await (await fetch(`${DEBUG}/json`)).json()).filter((x) => /sidepanel\.html/.test(x.url))) {
  const s = new S(t.webSocketDebuggerUrl); await s.open();
  await s.send('Runtime.enable').catch(() => null);
  const w = await s.ev('innerWidth');
  const data = w < 600 ? await s.ev(expr) : null;
  const fromStorage = w < 600 ? await s.ev(`chrome.storage.local.get('sessions').then((v) => { const s = (v.sessions||[])[0]; return s ? { id: s.id.slice(0,8), title: s.title, msgs: s.messages.map((m)=>({role:m.role, keys:Object.keys(m).join('+'), cLen:(m.content||'').length, rLen:(m.reasoning||'').length, note:m.note||null, usage:m.usage||null, at:new Date(m.at).toISOString()})) } : null; })`) : null;
  out.push({ innerW: w, data, fromStorage });
  s.ws.close();
}
await fs.writeFile('phantom-msg.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written');
