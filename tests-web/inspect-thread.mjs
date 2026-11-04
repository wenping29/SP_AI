// 只读取当前面板状态：每个气泡的结构 + 会话存储 + 账本
import fs from 'node:fs/promises';
const DEBUG = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url); this.nextId = 0; this.pending = new Map();
    this.ws.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); } });
  }
  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(method, params) { const id = ++this.nextId; this.ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((r) => this.pending.set(id, r)); }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.error) return { __cdp: r.error.message };
    const d = r.result?.exceptionDetails;
    if (d) return { __error: (d.exception?.description || d.text || '').slice(0, 300) };
    return r.result?.result?.value ?? null;
  }
}
const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const targets = (await list()).filter((t) => /sidepanel\.html/.test(t.url));
const rows = [];
for (const t of targets) {
  const s = new Session(t.webSocketDebuggerUrl); await s.open();
  await s.send('Runtime.enable').catch(() => null);
  await s.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  await sleep(200);
  rows.push({ id: t.id, innerW: await s.evaluate('innerWidth'), data: await s.evaluate(`(() => {
    const boxes = [...document.querySelectorAll('#thread .msg.assistant')].map((b) => ({
      cls: b.className,
      hasReasoning: Boolean(b.querySelector('.reasoning')),
      summary: b.querySelector('.reasoning summary')?.textContent || null,
      reasoningChars: b.querySelector('.reasoning-body')?.textContent.length || 0,
      body: (b.querySelector('.msg-body')?.textContent || b.textContent || '').slice(0, 40),
      meta: b.querySelector('.meta')?.textContent || null,
      actions: [...b.querySelectorAll('.msg-actions button')].map((x) => x.dataset.tip),
    }));
    const s = activeSession();
    return {
      status: document.querySelector('#status').textContent, busy: state.busy, model: state.model,
      title: s.title, boxes,
      stored: s.messages.map((m) => ({ role: m.role, content: (m.content || '').slice(0, 26), reasoning: (m.reasoning || '').length, note: m.note || null, usage: m.usage || null })),
    };
  })()`) });
  s.close();
}
const credits = await (async () => {
  const p = rows.find((r) => r.innerW < 600) || rows[0];
  if (!p) return null;
  const s = new Session(targets.find((t) => t.id === p.id).webSocketDebuggerUrl); await s.open();
  await s.send('Runtime.enable').catch(() => null);
  const v = await s.evaluate(`(async () => { const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } }); const d = await r.json(); return { balance: d.balance, top: d.transactions.slice(0, 6).map((t) => t.delta + ' ' + t.reason + ' ' + (t.modelId || '')) }; })()`);
  s.close();
  return v;
})();
await fs.writeFile('thread-dump.json', JSON.stringify({ rows, credits }, null, 2), 'utf8');
console.log('written thread-dump.json');
