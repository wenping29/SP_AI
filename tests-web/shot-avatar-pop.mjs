// 打开头像浮层并截图，给人看一眼最终长相
import fs from 'node:fs/promises';
const DEBUG = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class S {
  constructor(u) { this.ws = new WebSocket(u); this.n = 0; this.p = new Map();
    this.ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (d.id && this.p.has(d.id)) { this.p.get(d.id)(d); this.p.delete(d.id); } }); }
  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(m, p) { const id = ++this.n; this.ws.send(JSON.stringify({ id, method: m, params: p || {} })); return new Promise((r) => this.p.set(id, r)); }
  async ev(x) { const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? null; }
}
let picked = null;
for (const t of (await (await fetch(`${DEBUG}/json`)).json()).filter((x) => /sidepanel\.html/.test(x.url) && x.webSocketDebuggerUrl)) {
  const s = new S(t.webSocketDebuggerUrl); await s.open();
  await s.send('Runtime.enable').catch(() => null);
  await s.send('Page.enable').catch(() => null);
  await s.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  await sleep(300);
  if ((await s.ev('innerWidth')) < 600) { picked = s; break; }
  s.ws.close();
}
if (!picked) { console.log('no docked panel'); process.exit(1); }
await picked.ev(`showView('chat')`);
await sleep(400);
await picked.ev(`(() => { document.getElementById('avatarDock').classList.add('open'); document.getElementById('avatar').setAttribute('aria-expanded','true'); return 1; })()`);
await sleep(400);
const r = await picked.send('Page.captureScreenshot', { format: 'png' });
if (r?.result?.data) await fs.writeFile('avatar-pop-open.png', Buffer.from(r.result.data, 'base64'));
console.log('saved', await picked.ev(`JSON.stringify({pop:getComputedStyle(document.getElementById('accountPop')).display, balance:document.getElementById('popBalance').textContent, status:document.getElementById('popStatus').textContent})`));
picked.ws.close();
process.exit(0);
