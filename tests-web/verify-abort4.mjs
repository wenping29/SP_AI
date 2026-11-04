// 终止思考终检：真实点击 #stop 打断思考 → 气泡保留、不落会话、积分全额退回；再让它想完整跑一次
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
  return { status: document.querySelector('#status').textContent, busy: state.busy, model: state.model,
           stopHidden: stop.hidden, stopTip: stop.dataset.tip, boxClass: box?.className || null,
           clickPoint: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
           reasoningChars: box?.querySelector('.reasoning-body')?.textContent.length || 0,
           summary: box?.querySelector('.reasoning summary')?.textContent || null,
           body: clip((box?.querySelector('.msg-body')?.textContent || ''), 60),
           meta: box?.querySelector('.meta')?.textContent || null,
           msgCount: activeSession().messages.length,
           boxes: document.querySelectorAll('#thread .msg.assistant').length };
})()`;
const CREDITS = `(async () => { const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } }); const d = await r.json(); return { balance: d.balance, top: d.transactions.slice(0, 3).map((t) => t.delta + ' ' + t.reason + ' ' + (t.modelId || '')) }; })()`;

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const panelTargets = async () => (await list()).filter((t) => /sidepanel\.html/.test(t.url));
const out = {};

async function findDocked() {
  for (const t of await panelTargets()) {
    const s = new Session(t.webSocketDebuggerUrl); await s.open().catch(() => null);
    await s.send('Runtime.enable').catch(() => null);
    await s.send('Page.enable').catch(() => null);
    await s.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
    await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
    await sleep(250);
    const w = await s.evaluate('innerWidth');
    s.close();
    if (w < 600) return t;
  }
  return null;
}

const docked = await findDocked();
if (!docked) { out.fatal = '没有停靠的面板'; await fs.writeFile('abort4.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
const p = new Session(docked.webSocketDebuggerUrl); await p.open();
await p.send('Runtime.enable').catch(() => null);
await p.send('Page.enable').catch(() => null);
await p.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
await p.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
out.panel = await p.evaluate(`({ innerW: innerWidth, vis: document.visibilityState, focus: document.hasFocus() })`);

// 归零：掐掉任何残留请求，开新会话，选思考模型
await p.evaluate(`state.controller?.abort()`);
await sleep(1500);
await p.evaluate(`(() => { setReadPage(false); newChat(); state.model = 'deepseek-reasoner'; renderModels(); return 1; })()`);
await sleep(800);
out.before = await p.evaluate(SNAP);
out.creditsBefore = await p.evaluate(CREDITS);

async function sendPrompt(text) {
  await p.evaluate(`(() => { showView('chat'); document.getElementById('input').value = ${JSON.stringify(text)}; return 1; })()`);
  await p.evaluate(`send()`);
  await sleep(500);
}

async function trustedClick(x, y) {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await sleep(150);
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

// A. 思考中途用真实鼠标点击「终止思考」
await sendPrompt('9.11 和 9.9 哪个数更大？请说明理由。');
const traceA = [];
let clickA = null;
for (let i = 0; i < 50; i += 1) {
  await sleep(1000);
  const snap = await p.evaluate(SNAP);
  traceA.push({ sec: i + 1, busy: snap.busy, status: snap.status, tip: snap.stopTip, r: snap.reasoningChars, b: snap.body.length, boxes: snap.boxes });
  if (snap.reasoningChars >= 120 && snap.stopTip === '终止思考' && !clickA) {
    await trustedClick(snap.clickPoint.x, snap.clickPoint.y);
    clickA = { sec: i + 1, point: snap.clickPoint, reasoningAtClick: snap.reasoningChars };
    await sleep(2500);
    const after = await p.evaluate(SNAP);
    if (after.busy) {
      await p.evaluate(`document.getElementById('stop').click()`);
      await sleep(2500);
      out.abort = { clickA, trustedClickWorked: false, after: await p.evaluate(SNAP) };
    } else {
      out.abort = { clickA, trustedClickWorked: true, after: after };
    }
    break;
  }
}
if (!out.abort) out.abort = { clickA, note: '没等到思考流', traceTail: traceA.slice(-5) };
out.abort.trace = traceA;
out.abort.credits = await p.evaluate(CREDITS);
out.abort.session = await p.evaluate(`activeSession().messages.map((m) => m.role + ':' + clip(m.content || '(空)', 22) + (m.reasoning ? '|R' + m.reasoning.length : '') + (m.note ? '|N' + m.note : ''))`);

// B. 完整跑完一次：思考块收口 + usage + 持久化
await sendPrompt('一个笼子里有鸡和兔共 8 只，腿共 22 条，各有几只？');
let doneB = null;
const traceB = [];
for (let i = 0; i < 100; i += 1) {
  await sleep(1000);
  const snap = await p.evaluate(SNAP);
  traceB.push({ sec: i + 1, busy: snap.busy, status: snap.status, r: snap.reasoningChars, b: snap.body.length });
  if (!snap.busy && i > 1) { doneB = snap; break; }
}
out.completed = { snap: doneB, trace: traceB, credits: await p.evaluate(CREDITS) };

// C. 重渲染后思考过程是否还在
out.rerender = await p.evaluate(`(() => {
  renderThread();
  const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1);
  return { summary: box?.querySelector('.reasoning summary')?.textContent || null,
           reasoningChars: box?.querySelector('.reasoning-body')?.textContent.length || 0,
           answer: clip(box?.querySelector('.msg-body')?.textContent || '', 30),
           meta: box?.querySelector('.meta')?.textContent || null,
           savedReasoning: (activeSession().messages.at(-1)?.reasoning || '').length };
})()`);

out.shot = await p.shot('abort4.png');
// 收尾：还原模型偏好，避免下次验证带着思考模型跑
await p.evaluate(`(() => { state.model = 'glm-4v-flash'; els.model.value = 'glm-4v-flash'; renderModels(); return saveState({ model: 'glm-4v-flash' }); })()`).catch(() => null);
await fs.writeFile('abort4.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written abort4.json');
p.close();
process.exit(0);
