// 对比面板内已加载的 ask() 源码与磁盘文件，确认扩展是否跑的是旧代码
import fs from 'node:fs/promises';
const DEBUG = 'http://127.0.0.1:9333';
class S {
  constructor(u) { this.ws = new WebSocket(u); this.n = 0; this.p = new Map();
    this.ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { this.p.get(d.id)(d); this.p.delete(d.id); } }); }
  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(m, p) { const id = ++this.n; this.ws.send(JSON.stringify({ id, method: m, params: p || {} })); return new Promise((r) => this.p.set(id, r)); }
  async ev(x) {
    const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __e: r.result.exceptionDetails.text, __d: r.result.exceptionDetails.exception?.description?.slice(0, 200) };
    return r.result?.result?.value ?? { __null: JSON.stringify(r).slice(0, 200) };
  }
}
const out = {};
for (const t of (await (await fetch(`${DEBUG}/json`)).json()).filter((x) => /sidepanel\.html/.test(x.url))) {
  const s = new S(t.webSocketDebuggerUrl); await s.open();
  await s.send('Runtime.enable').catch(() => null);
  if ((await s.ev('innerWidth')) >= 600) { s.ws.close(); continue; }
  out.typeOfAsk = await s.ev('typeof ask');
  out.askLen = await s.ev('String(ask).length');
  const src = await s.ev('String(ask)');
  out.abortSlice = typeof src === 'string' ? src.slice(Math.max(0, src.indexOf('AbortError') - 260), src.indexOf('AbortError') + 900) : src;
  out.hasNewComment = typeof src === 'string' ? src.includes('气泡留着讲清楚') : null;
  out.scriptSrc = await s.ev(`[...document.querySelectorAll('script')].map((x)=>x.src + '?' + (x.textContent ? 'inline' + x.textContent.length : 'file')).join(',')`);
  out.fetchFile = await s.ev(`fetch('sidepanel.js').then((r)=>r.text()).then((t)=>({len:t.length, hasComment:t.includes('气泡留着讲清楚'), abortIdx:t.indexOf('AbortError')}))`);
  fs.writeFileSync('loaded-ask.txt', typeof src === 'string' ? src : JSON.stringify(src), 'utf8');
  s.ws.close();
  break;
}
await fs.writeFile('loaded-ask.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written');
