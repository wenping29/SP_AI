// 看账本：这 88 分扣在哪
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
  await sleep(200);
  picked = s; break;
}
if (!picked) { console.log('no panel'); process.exit(1); }
const rows = await picked.ev(`(async () => { const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } }); const d = await r.json(); return JSON.stringify({ device: state.deviceId.slice(0,8), balance: d.balance, rows: d.transactions.slice(0, 8).map((t) => t.delta + ' ' + t.reason + ' ' + (t.modelId||'') + ' ' + new Date(t.createdAt).toISOString().slice(11,19)) }); })()`);
await fs.writeFile('ledger-check.json', typeof rows === 'string' ? rows : JSON.stringify(rows, null, 2), 'utf8');
console.log(rows);
picked.ws.close();
process.exit(0);
