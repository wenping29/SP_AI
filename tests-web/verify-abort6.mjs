// 终止思考终检（面板重载后）：确认加载的是当前代码 → 干净会话 → 真实点击终止 → 检查历史里是否留下空气泡
import fs from 'node:fs/promises';
const DEBUG = 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8899/fixture.html';
const EXT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url); this.nextId = 0; this.pending = new Map(); this.contexts = new Map();
    this.ws.addEventListener('message', (e) => {
      const d = JSON.parse(e.data);
      if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      if (d.method === 'Runtime.executionContextCreated') this.contexts.set(d.params.context.id, d.params.context);
    });
  }
  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(method, params) { const id = ++this.nextId; this.ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((r) => this.pending.set(id, r)); }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.error) return { __cdp: r.error.message };
    const d = r.result?.exceptionDetails;
    if (d) return { __error: (d.exception?.description || d.text || '').slice(0, 300) };
    const v = r.result?.result?.value;
    return v === undefined ? { __undefined: JSON.stringify(r.result?.result || {}).slice(0, 200) } : v;
  }
  async wake() {
    await this.send('Page.enable').catch(() => null);
    await this.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  }
  async shot(f) { const r = await this.send('Page.captureScreenshot', { format: 'png' }).catch(() => null); if (r?.result?.data) { await fs.writeFile(f, Buffer.from(r.result.data, 'base64')); return true; } return false; }
  close() { this.ws.close(); }
}
const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const panels = async () => (await list()).filter((t) => /sidepanel\.html/.test(t.url));

const SNAP = `(() => {
  const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1) || null;
  const stop = document.getElementById('stop');
  const r = stop.getBoundingClientRect();
  return JSON.stringify({
    status: document.querySelector('#status').textContent, busy: state.busy, controller: Boolean(state.controller),
    model: state.model, tip: stop.dataset.tip, stopHidden: stop.hidden,
    point: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
    boxClass: box ? box.className : null, reasoningChars: box ? (box.querySelector('.reasoning-body')?.textContent.length || 0) : 0,
    summary: box?.querySelector('.reasoning summary')?.textContent || null,
    body: clip(box?.querySelector('.msg-body')?.textContent || '', 40),
    meta: box?.querySelector('.meta')?.textContent || null,
    activeId: state.activeId.slice(0, 8), msgCount: activeSession().messages.length,
    sessions: state.sessions.map((s) => s.id.slice(0, 8) + '/' + s.messages.length + '/' + s.messages.map((m) => m.role + '(' + (m.content || '').length + ',r' + (m.reasoning || '').length + ',' + Object.keys(m).join('+') + ')').join(' ')),
    boxes: document.querySelectorAll('#thread .msg.assistant').length,
    uptime: Math.round(performance.now() / 1000) });
})()`;
const snap = async (s) => { const raw = await s.evaluate(SNAP); return typeof raw === 'string' ? JSON.parse(raw) : raw; };

async function findDocked() {
  for (const t of await panels()) {
    const s = new Session(t.webSocketDebuggerUrl); await s.open().catch(() => null);
    await s.send('Runtime.enable').catch(() => null); await s.wake(); await sleep(250);
    const w = await s.evaluate('innerWidth');
    if (w < 600) return s;
    s.close();
  }
  return null;
}

const out = { steps: [] };
let panel = await findDocked();
if (!panel) { out.fatal = '没有停靠面板'; await fs.writeFile('abort6.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }

// 1) 重载面板文档，确保跑的是磁盘上的当前代码
await panel.evaluate(`location.reload()`).catch(() => null);
await sleep(5000);
panel.close();
panel = await findDocked();
if (!panel) { out.fatal = '重载后面板不再停靠'; await fs.writeFile('abort6.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }

// 2) 代码指纹：已加载的 ask() 是否包含当前实现
out.codeProbe = await panel.evaluate(`(() => {
  const src = String(ask);
  return JSON.stringify({ len: src.length, hasThinkingBranch: src.includes('思考过程（已终止）'),
    hasReasoningPush: src.includes('reasoning: clip(reasoning, 1600)'), hasUploadVoice: typeof uploadVoice === 'function' });
})()`);
if (typeof out.codeProbe === 'string') out.codeProbe = JSON.parse(out.codeProbe);
out.uptimeAfterReload = (await snap(panel)).uptime;

// 3) 干净会话：清空历史列表，让 activeSession() 现场新建一个
await panel.evaluate(`(() => { state.sessions = []; state.activeId = ''; renderThread(); return 1; })()`);
await sleep(400);
await panel.evaluate(`(() => { setReadPage(false); state.model = 'deepseek-reasoner'; renderModels(); return 1; })()`);
await sleep(600);
out.before = await snap(panel);
out.creditsBefore = await panel.evaluate(`(async () => { const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } }); const d = await r.json(); return JSON.stringify({ balance: d.balance, top: d.transactions.slice(0, 3).map((t) => t.delta + ' ' + t.reason) }); })()`);

// 4) 发送需要思考的问题，等思考流出现后用真实鼠标点击 #stop
await panel.evaluate(`(() => { showView('chat'); document.getElementById('input').value = '9.11 和 9.9 哪个数更大？请说明理由。'; return 1; })()`);
await panel.evaluate(`send()`);
await sleep(1200);
out.justSent = await snap(panel);
const trace = [];
let clicked = null;
for (let i = 0; i < 45; i += 1) {
  const s = await snap(panel);
  trace.push({ sec: i, busy: s.busy, tip: s.tip, r: s.reasoningChars, msgs: s.msgCount, status: s.status });
  if (!clicked && s.reasoningChars >= 120 && s.tip === '终止思考') {
    await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.point.x, y: s.point.y, buttons: 0, clickCount: 0 });
    await sleep(150);
    await panel.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.point.x, y: s.point.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    await panel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.point.x, y: s.point.y, button: 'left', buttons: 0, clickCount: 1 });
    clicked = { sec: i, point: s.point, reasoningAtClick: s.reasoningChars };
    await sleep(3000);
    out.abort = { clicked, after: await snap(panel) };
    break;
  }
  await sleep(1000);
}
out.abort = out.abort || { clicked, note: '没等到思考流', tail: trace.slice(-4) };
out.abort.trace = trace;
out.abort.credits = await panel.evaluate(`(async () => { const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } }); const d = await r.json(); return JSON.stringify({ balance: d.balance, top: d.transactions.slice(0, 3).map((t) => t.delta + ' ' + t.reason) }); })()`);
out.abort.renderedAfterRerender = await panel.evaluate(`(() => { renderThread(); return JSON.stringify([...document.querySelectorAll('#thread .msg')].map((b) => b.className + '|' + (b.textContent || '').slice(0, 30))); })()`);

// 5) 让同一条问题重跑一遍并完整结束，验证思考过程落库
await panel.evaluate(`(() => { document.getElementById('input').value = '9.11 和 9.9 哪个数更大？请说明理由。'; return 1; })()`);
await panel.evaluate(`send()`);
let doneB = null;
const traceB = [];
for (let i = 0; i < 110; i += 1) {
  await sleep(1000);
  const s = await snap(panel);
  traceB.push({ sec: i + 1, busy: s.busy, r: s.reasoningChars, b: s.body.length, msgs: s.msgCount });
  if (!s.busy && i > 2) { doneB = s; break; }
}
out.completed = { snap: doneB, credits: await panel.evaluate(`(async () => { const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } }); const d = await r.json(); return JSON.stringify({ balance: d.balance, top: d.transactions.slice(0, 3).map((t) => t.delta + ' ' + t.reason + ' ' + (t.modelId||'')) }); })()`), trace: traceB };
out.shot = await panel.shot('abort6.png');
await panel.evaluate(`(() => { state.model = 'glm-4v-flash'; els.model.value = 'glm-4v-flash'; renderModels(); return saveState({ model: 'glm-4v-flash' }); })()`).catch(() => null);
await fs.writeFile('abort6.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written abort6.json');
panel.close();
process.exit(0);
