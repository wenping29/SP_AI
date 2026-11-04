// 定位「终止思考」到底哪一环失效：可信点击 / DOM click / controller.abort 分层验证
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
}
const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const SNAP = `(() => {
  const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1) || null;
  const stop = document.getElementById('stop');
  const r = stop.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return { innerW: innerWidth, vis: document.visibilityState, focus: document.hasFocus(),
           status: document.querySelector('#status').textContent, busy: state.busy, model: state.model,
           hasController: Boolean(state.controller),
           stopHidden: stop.hidden, stopTip: stop.dataset.tip,
           stopRect: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) },
           elementAtStop: hit ? (hit.id || hit.className || hit.tagName) + (stop.contains(hit) ? '(在按钮内)' : '') : null,
           streaming: Boolean(box?.classList.contains('streaming')),
           reasoningChars: box?.querySelector('.reasoning-body')?.textContent.length || 0,
           summary: box?.querySelector('.reasoning summary')?.textContent || null,
           body: clip((box?.querySelector('.msg-body')?.textContent || ''), 40),
           msgCount: activeSession().messages.length,
           boxes: document.querySelectorAll('#thread .msg.assistant').length };
})()`;

const targets = (await list()).filter((t) => /sidepanel\.html/.test(t.url));
const out = { panelCount: targets.length };
let picked = null;
for (const t of targets) {
  const s = new Session(t.webSocketDebuggerUrl); await s.open();
  await s.send('Runtime.enable').catch(() => null);
  await s.send('Page.enable').catch(() => null);
  await s.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  await sleep(300);
  const probe = await s.evaluate(SNAP);
  if (probe?.innerW < 600 && probe?.busy) { picked = { s, id: t.id, before: probe }; break; }
  if (probe?.innerW < 600 && !picked) picked = { s, id: t.id, before: probe }; else if (!picked) picked = { s, id: t.id, before: probe };
}
if (!picked?.s) { out.fatal = '没有面板'; await fs.writeFile('abort3.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
const { s, before } = picked;
out.pickedId = picked.id;
out.before = before;

async function trustedClick(x, y) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await sleep(150);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

// 第 1 层：可信鼠标点击 #stop
if (before.busy) {
  await trustedClick(before.stopRect.x, before.stopRect.y);
  await sleep(2500);
  out.afterTrustedClick = await s.evaluate(SNAP);
  // 第 2 层：DOM 直接触发 click（绕开命中测试，验证监听器本身）
  if (out.afterTrustedClick?.busy) {
    await s.evaluate(`document.getElementById('stop').click()`);
    await sleep(2500);
    out.afterDomClick = await s.evaluate(SNAP);
  }
  // 第 3 层：直接 abort 控制器（验证 streamChat 的 signal 是否真的接上了）
  if (out.afterDomClick?.busy) {
    await s.evaluate(`state.controller?.abort()`);
    await sleep(2500);
    out.afterControllerAbort = await s.evaluate(SNAP);
  }
}

out.session = await s.evaluate(`activeSession().messages.map((m) => m.role + ':' + clip(m.content || '(空)', 26) + (m.reasoning ? '|R' + m.reasoning.length : '') + (m.note ? '|N' + m.note : ''))`);
out.ledger = await s.evaluate(`(async () => { const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } }); const d = await r.json(); return { balance: d.balance, top: d.transactions.slice(0, 4).map((t) => t.delta + ' ' + t.reason + ' ' + (t.modelId || '')) }; })()`);
out.shot = await s.shot('abort3.png');
await fs.writeFile('abort3.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written abort3.json');
s.close();
process.exit(0);
