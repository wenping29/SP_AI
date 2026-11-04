// 真机复核 2：思考流显示 + 终止思考（含退款），以及思考过程的持久化
// node verify-thinking-abort.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8899/fixture.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0; this.pending = new Map(); this.contexts = new Map();
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) { this.pending.get(data.id)(data); this.pending.delete(data.id); }
      if (data.method === 'Runtime.executionContextCreated') this.contexts.set(data.params.context.id, data.params.context);
    });
  }
  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(method, params) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => this.pending.set(id, r));
  }
  async evaluate(expression, contextId) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, contextId });
    if (response.error) return { __cdp: response.error.message };
    const detail = response.result?.exceptionDetails;
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 240) };
    return response.result?.result?.value ?? null;
  }
  async wake() {
    await this.send('Page.enable').catch(() => null);
    await this.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (r?.result?.data) { await fs.writeFile(file, Buffer.from(r.result.data, 'base64')); return true; }
    return false;
  }
  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const panelTargets = async () => (await list()).filter((t) => /sidepanel\.html/.test(t.url));
const out = {};

async function connect(t) {
  const s = new Session(t.webSocketDebuggerUrl);
  await s.open().catch(() => null);
  await s.send('Runtime.enable').catch(() => null);
  await s.wake();
  await sleep(250);
  return s;
}

async function creditsOf(panel) {
  return panel.evaluate(`(async () => {
    const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } });
    const d = await r.json();
    return { balance: d.balance, top: d.transactions.slice(0, 3).map((t) => t.delta + ' ' + t.reason + ' ' + t.modelId) };
  })()`);
}

async function trustedClick(s, x, y) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await sleep(140);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(70);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(600);
}

async function survey() {
  const rows = [];
  for (const t of await panelTargets()) {
    const s = await connect(t);
    rows.push({ id: t.id, ...(await s.evaluate(`({ innerW: innerWidth, booted: typeof state !== 'undefined' && Boolean(state.token) })`) || {}) });
    s.close();
  }
  return rows.find((r) => r.innerW < 600) || null;
}

// 面板实例：直接找一个停靠的；没有就用悬浮栏手势召唤
let docked = await survey();
if (!docked) {
  const t0 = (await list()).find((t) => /fixture\.html/.test(t.url));
  const fix = await connect(t0 || await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json());
  await fix.send('Page.navigate', { url: FIXTURE });
  await sleep(3000);
  await fix.send('Page.bringToFront').catch(() => null);
  await fix.wake();
  let world = null;
  for (const id of fix.contexts.keys()) {
    if (await fix.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { world = id; break; }
  }
  const box = await fix.evaluate(`(() => { const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail')); const b=h?.shadowRoot?.querySelector('.rail button[data-tip="打开聊天"]'); const r=b?.getBoundingClientRect(); return r?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}:null; })()`, world);
  if (box) await trustedClick(fix, box.x, box.y);
  for (let i = 0; i < 15; i += 1) { await sleep(1000); docked = await survey(); if (docked) break; }
  fix.close();
}
out.docked = docked;
if (!docked?.id) { out.fatal = '没有面板实例'; await fs.writeFile('think-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
const panel = await connect((await panelTargets()).find((t) => t.id === docked.id));
await sleep(800);

out.beforeAll = await creditsOf(panel);

// 状态归零：关掉阅读此页，新开会话，选思考模型
await panel.evaluate(`(() => { setReadPage(false); newChat(); state.model = 'deepseek-reasoner'; renderModels(); return { model: state.model, readPage: state.readPage }; })()`);
await sleep(600);

async function sendPrompt(text) {
  await panel.evaluate(`(() => { showView('chat'); const i = document.getElementById('input'); i.value = ${JSON.stringify(text)}; return 1; })()`);
  await panel.evaluate(`send()`);
  await sleep(400);
}

async function snapshot() {
  return panel.evaluate(`(() => {
    const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1) || null;
    const reasoning = box?.querySelector('.reasoning-body');
    return { status: document.querySelector('#status').textContent, busy: state.busy,
             stopVisible: !document.getElementById('stop').hidden, stopTip: document.getElementById('stop').dataset.tip,
             streaming: Boolean(box?.classList.contains('streaming')), boxClass: box?.className || null,
             reasoningChars: reasoning ? reasoning.textContent.length : 0,
             summary: box?.querySelector('.reasoning summary')?.textContent || null,
             answer: box?.querySelector('.msg-body')?.textContent || '',
             meta: box?.querySelector('.meta')?.textContent || null };
  })()`);
}

// ---------- A. 思考中途终止 ----------
await sendPrompt('9.11 和 9.9 哪个数更大？请说明理由。');
const traceA = [];
let abortedAt = null;
for (let i = 0; i < 60; i += 1) {
  await sleep(1000);
  const snap = await snapshot();
  traceA.push({ sec: i + 1, busy: snap.busy, status: snap.status, stopTip: snap.stopTip, reasoningChars: snap.reasoningChars, answerChars: snap.answer.length });
  if (snap.reasoningChars >= 60 && snap.stopVisible && !abortedAt) {
    const box = await panel.evaluate(`(() => { const b = document.getElementById('stop'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    await trustedClick(panel, box.x, box.y);
    abortedAt = { sec: i + 1, ...snap };
    break;
  }
}
await sleep(2000);
out.abort = { at: abortedAt, after: await snapshot(), credits: await creditsOf(panel) };
out.abort.session = await panel.evaluate(`(() => ({ msgs: activeSession().messages.map((m) => m.role + ':' + clip(m.content || '(空)', 24)), count: activeSession().messages.length }))()`);

// ---------- B. 让它想完 ----------
await sendPrompt('一个笼子里有鸡和兔共 8 只，腿共 22 条，各有几只？');
const traceB = [];
let doneB = null;
for (let i = 0; i < 120; i += 1) {
  await sleep(1000);
  const snap = await snapshot();
  traceB.push({ sec: i + 1, busy: snap.busy, status: snap.status, reasoningChars: snap.reasoningChars, answerChars: snap.answer.length });
  if (!snap.busy && i > 1) { doneB = snap; break; }
}
out.completed = { snap: doneB, credits: await creditsOf(panel) };

// ---------- C. 思考过程是否随会话持久化（重渲染后还在） ----------
out.rerender = await panel.evaluate(`(() => {
  renderThread();
  const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1);
  return { summary: box?.querySelector('.reasoning summary')?.textContent || null,
           reasoningChars: box?.querySelector('.reasoning-body')?.textContent.length || 0,
           answer: clip(box?.querySelector('.msg-body')?.textContent || '', 40),
           savedReasoning: (activeSession().messages.at(-1)?.reasoning || '').length,
           actions: [...(box?.querySelectorAll('.msg-actions button') || [])].map((b) => b.dataset.tip + '/' + (b.textContent || '').trim()) };
})()`);
out.stored = await panel.evaluate(`chrome.storage.local.get('sessions').then((v) => (v.sessions || []).map((s) => s.messages.map((m) => m.role + ':' + (m.reasoning ? 'R' + m.reasoning.length : '-')).join(','))[0] || null)`);

// ---------- D. 没有思考过程时直接终止：不该留空气泡 ----------
const countBefore = await panel.evaluate(`activeSession().messages.length`);
await sendPrompt('说一个字：好');
let abortedEmpty = null;
for (let i = 0; i < 12; i += 1) {
  await sleep(300);
  const snap = await snapshot();
  if (snap.busy && snap.reasoningChars === 0 && snap.stopVisible) {
    await panel.evaluate(`state.controller?.abort()`);
    await sleep(1200);
    abortedEmpty = { snap, after: await snapshot() };
    break;
  }
  if (!snap.busy && i > 1) break;
}
out.emptyAbort = { at: abortedEmpty, countAfter: await panel.evaluate(`activeSession().messages.length`), countBefore, boxes: await panel.evaluate(`document.querySelectorAll('#thread .msg.assistant').length`) };

out.shotPanel = await panel.shot('think-panel.png');
out.logs = panel.logs || null;

// 收尾：把模型选择还原成测试前的值
await panel.evaluate(`(() => { state.model = 'glm-4v-flash'; els.model.value = 'glm-4v-flash'; renderModels(); return saveState({ model: 'glm-4v-flash' }); })()`).catch(() => null);
await fs.writeFile('think-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written think-report.json');
panel.close();
process.exit(0);
