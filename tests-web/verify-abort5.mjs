// 终止思考终检（纯净版）：先确认面板真的空闲，再发一条需要思考的问题，用真实鼠标点击「终止思考」
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
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (r?.result?.data) { await fs.writeFile(file, Buffer.from(r.result.data, 'base64')); return true; }
    return false;
  }
  close() { this.ws.close(); }
}

const SNAP = `(() => {
  const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1) || null;
  const stop = document.getElementById('stop');
  const r = stop.getBoundingClientRect();
  return { status: document.querySelector('#status').textContent, busy: state.busy, controller: Boolean(state.controller),
           model: state.model, stopHidden: stop.hidden, stopTip: stop.dataset.tip,
           point: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
           boxClass: box?.className || null, reasoningChars: box?.querySelector('.reasoning-body')?.textContent.length || 0,
           summary: box?.querySelector('.reasoning summary')?.textContent || null,
           body: clip((box?.querySelector('.msg-body')?.textContent || ''), 40),
           meta: box?.querySelector('.meta')?.textContent || null,
           msgCount: activeSession().messages.length, boxes: document.querySelectorAll('#thread .msg.assistant').length };
})()`;
const CREDITS = `(async () => { const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } }); const d = await r.json(); return { balance: d.balance, top: d.transactions.slice(0, 3).map((t) => t.delta + ' ' + t.reason + ' ' + (t.modelId || '')) }; })()`;

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const out = {};
let panel = null;
for (const t of (await list()).filter((x) => /sidepanel\.html/.test(x.url))) {
  const s = new Session(t.webSocketDebuggerUrl); await s.open().catch(() => null);
  await s.send('Runtime.enable').catch(() => null);
  await s.send('Page.enable').catch(() => null);
  await s.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  await sleep(300);
  if ((await s.evaluate('innerWidth')) < 600) { panel = s; break; }
  s.close();
}
if (!panel) { out.fatal = '没有停靠的面板'; await fs.writeFile('abort5.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }

// 空闲闸门：残留请求先掐掉，等到 busy=false 且 controller=null 连续两次成立
await panel.evaluate(`state.controller?.abort()`);
let idle = 0;
for (let i = 0; i < 40 && idle < 2; i += 1) {
  await sleep(2000);
  const s = await panel.evaluate(SNAP);
  idle = s && !s.busy && !s.controller ? idle + 1 : 0;
  out.idleWait = { sec: (i + 1) * 2, busy: s?.busy, controller: s?.controller };
}
await panel.evaluate(`(() => { setReadPage(false); newChat(); state.model = 'deepseek-reasoner'; renderModels(); return 1; })()`);
await sleep(1000);
out.before = await panel.evaluate(SNAP);
out.creditsBefore = await panel.evaluate(CREDITS);

await panel.evaluate(`(() => { showView('chat'); document.getElementById('input').value = '9.11 和 9.9 哪个数更大？请说明理由。'; return 1; })()`);
await panel.evaluate(`send()`);
await sleep(1500);
out.justSent = await panel.evaluate(SNAP);   // 必须看到 msgCount 1，证明这条真的发出去了

const trace = [];
let click = null;
for (let i = 0; i < 40; i += 1) {
  await sleep(1000);
  const snap = await panel.evaluate(SNAP);
  trace.push({ sec: i + 1, busy: snap.busy, status: snap.status, tip: snap.snap?.stopTip || snap.stopTip, r: snap.reasoningChars, msgs: snap.msgCount });
  if (snap.reasoningChars >= 120 && snap.stopTip === '终止思考' && !click) {
    await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: snap.point.x, y: snap.point.y, buttons: 0, clickCount: 0 });
    await sleep(150);
    await panel.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: snap.point.x, y: snap.point.y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    await panel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: snap.point.x, y: snap.point.y, button: 'left', buttons: 0, clickCount: 1 });
    click = { sec: i + 1, point: snap.point, reasoningAtClick: snap.reasoningChars };
    await sleep(2500);
    const after = await panel.evaluate(SNAP);
    out.abort = { click, trustedClickWorked: !after.busy, after };
    break;
  }
}
out.abort = out.abort || { click, note: '没等到思考流', traceTail: trace.slice(-4) };
out.abort.trace = trace;
out.abort.credits = await panel.evaluate(CREDITS);
out.abort.session = await panel.evaluate(`activeSession().messages.map((m) => m.role + ':' + clip(m.content || '(空)', 22) + (m.reasoning ? '|R' + m.reasoning.length : '') + (m.note ? '|N' + m.note : ''))`);
out.abort.stored = await panel.evaluate(`chrome.storage.local.get('sessions').then((v) => (v.sessions || []).slice(0, 2).map((s) => s.title + ' :: ' + s.messages.map((m) => m.role + (m.reasoning ? '(R' + m.reasoning.length + ')' : '')).join(',')))`);
out.shot = await panel.shot('abort5.png');
await panel.evaluate(`(() => { state.model = 'glm-4v-flash'; els.model.value = 'glm-4v-flash'; renderModels(); return saveState({ model: 'glm-4v-flash' }); })()`).catch(() => null);
await fs.writeFile('abort5.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written abort5.json');
panel.close();
process.exit(0);
