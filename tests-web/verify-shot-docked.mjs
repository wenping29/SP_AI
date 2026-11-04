// 停靠面板里的截图按钮：真实手势打开面板后，captureVisibleTab 能否拿到网页截图
// node verify-shot-docked.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = process.env.CDP || 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8899/fixture.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.contexts = new Map();
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 260) };
    return response.result?.result?.value ?? null;
  }
  close() { this.ws.close(); }
}
const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const out = {};

// 面板全部关掉，确保后面看到的是手势新打开的停靠实例
for (const t of await list()) {
  if (/sidepanel\.html/.test(t.url)) await fetch(`${DEBUG}/json/close/${t.id}`).catch(() => {});
}
await sleep(1200);

const fxTarget = (await list()).find((t) => /fixture\.html/.test(t.url));
const fixture = new Session(fxTarget.webSocketDebuggerUrl);
await fixture.open();
await fixture.send('Page.enable');
await fixture.send('Page.navigate', { url: FIXTURE });
await sleep(4000);
await fixture.send('Page.bringToFront');
await fixture.send('Runtime.enable');
await sleep(800);

let worldId = null;
for (const id of fixture.contexts.keys()) {
  if (await fixture.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;
await fixture.evaluate(`chrome.storage.local.remove('pending')`, worldId);
await fixture.evaluate(`chrome.storage.local.set({ sessions: [], activeSession: null })`, worldId);

const toolbar = await fixture.evaluate(await fs.readFile('expr-toolbar.js', 'utf8'), worldId);
const button = (toolbar.buttons || []).find((item) => item.label === '翻译');
out.button = button || null;
if (button) {
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y, buttons: 0, clickCount: 0 });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: button.x, y: button.y, button: 'left', buttons: 1, clickCount: 1 });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: button.x, y: button.y, button: 'left', buttons: 0, clickCount: 1 });
}

// 等停靠面板出现并跑完这次划词
let panel = null;
for (let i = 0; i < 20; i += 1) {
  await sleep(1000);
  const t = (await list()).find((x) => /sidepanel\.html/.test(x.url));
  if (t && !panel) {
    panel = new Session(t.webSocketDebuggerUrl);
    await panel.open().catch(() => null);
    await panel.send('Runtime.enable').catch(() => {});
    await sleep(500);
    const ready = await panel.evaluate('1').catch(() => null);
    if (ready !== 1) { panel.close(); panel = null; continue; }
  }
  if (panel) {
    const s = await panel.evaluate(`({ booted: typeof els !== 'undefined' && !!els.btnShot, busy: state.busy, msgs: document.querySelectorAll('#thread .msg').length })`).catch(() => null);
    out.wait = { sec: i + 1, ...(s || {}) };
    if (s && s.booted && !s.busy && s.msgs >= 2) break;
  }
}
if (!panel) { out.error = '停靠面板没出现'; console.log(JSON.stringify(out, null, 2)); process.exit(1); }

out.activeTab = await panel.evaluate(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((t) => t.map((x) => ({ id: x.id, url: (x.url || '').slice(0, 45) })))`);

// 截图
await panel.evaluate(`els.btnShot.click(); 'clicked'`);
await sleep(2500);
out.afterShot = await panel.evaluate(`(() => ({
  status: els.status.textContent.trim(),
  kinds: state.attachments.map((a) => a.kind + ':' + a.name + ':' + (a.dataUrl || '').length),
  thumbs: els.attachments.querySelectorAll('img').length,
}))()`);

const LEDGER = `(async () => {
  const s = await chrome.storage.local.get(['server', 'token']);
  const base = (s.server && /^https?:/.test(s.server)) ? s.server : 'http://127.0.0.1:5080';
  const r = await fetch(base + '/api/credits', { headers: { Authorization: 'Bearer ' + s.token } });
  const j = await r.json();
  return { balance: j.balance, rows: (j.transactions || []).length };
})()`;

// 非视觉模型下带图发送 → 应拦住且不扣分
const before = await panel.evaluate(LEDGER);
await panel.evaluate(`els.input.value = '图里有什么？'; els.send.click(); 'sent'`);
await sleep(2500);
const after = await panel.evaluate(LEDGER);
out.guard = { before, after, status: await panel.evaluate(`els.status.textContent.trim()`), kept: await panel.evaluate(`state.attachments.length`) };

await fs.writeFile('shot-docked-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written shot-docked-report.json');
fixture.close();
panel.close();
process.exit(0);
