// 收尾复核：纯视图按钮只切视图不扣分，「总结全文」恰好产生一条 chat 流水
// node verify-launcher3.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 200) };
    return response.result?.result?.value ?? null;
  }
  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const out = {};

const panelTarget = (await list()).find((t) => /sidepanel\.html/.test(t.url) && t.type === 'page');
const fixTarget = (await list()).find((t) => /fixture\.html/.test(t.url) && t.type === 'page');
if (!panelTarget || !fixTarget) { out.fatal = { panel: !!panelTarget, fixture: !!fixTarget }; await fs.writeFile('launcher3-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }

const panel = new Session(panelTarget.webSocketDebuggerUrl);
await panel.open();
await panel.send('Runtime.enable');
const fix = new Session(fixTarget.webSocketDebuggerUrl);
await fix.open();
await fix.send('Runtime.enable');
await sleep(600);

let worldId = null;
for (const id of fix.contexts.keys()) {
  if (await fix.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;
out.panelWidth = await panel.evaluate(`innerWidth`);

const SNAP = `(() => ({
  innerW: innerWidth, view: document.querySelector('#rail button.active')?.dataset.view,
  viewTitle: document.querySelector('#viewTitle')?.textContent,
  model: document.querySelector('#model')?.value, status: document.querySelector('#status')?.textContent?.trim(),
  msgs: document.querySelectorAll('#thread .msg').length,
  streaming: !!document.querySelector('#thread .msg.streaming'),
}))()`;
const CREDITS = `(async () => {
  const live = typeof state === 'undefined' ? {} : state;
  const { server, token } = await chrome.storage.local.get(['server','token']);
  const r = await fetch((live.server || server || 'http://127.0.0.1:5080') + '/api/credits', { headers: { Authorization: 'Bearer ' + (live.token || token) } });
  const j = await r.json();
  return { status: r.status, balance: j.balance, tx: (j.transactions || []).slice(0, 6) };
})()`;

async function railBox(title) {
  return fix.evaluate(`(() => {
    const host = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
    const btn = host?.shadowRoot?.querySelector('.rail button[title="' + ${JSON.stringify(title)} + '"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    return { x, y, innerW: innerWidth, hidden: host.shadowRoot.querySelector('.rail').hidden,
             hit: document.elementFromPoint(x, y) === host, ring: getComputedStyle(btn).boxShadow.includes('123, 63, 228') };
  })()`, worldId);
}
async function clickBox(b) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, buttons: 0, clickCount: 0 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x, y: b.y, button: 'left', buttons: 1, clickCount: 1 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', buttons: 0, clickCount: 1 });
}

// 先把面板切到非聊天视图，才能看出「打开聊天」按钮真的换了视图
await panel.evaluate(`(() => { const b = [...document.querySelectorAll('#rail button')].find((x) => x.dataset.view === 'tools'); b.click(); return b.dataset.view; })()`);
await sleep(600);
out.beforeChat = await panel.evaluate(SNAP);
const ledgerA = await panel.evaluate(CREDITS);
const boxChat = await railBox('打开聊天');
out.boxChat = boxChat;
if (boxChat?.hit) await clickBox(boxChat);
await sleep(1600);
out.afterChat = await panel.evaluate(SNAP);
out.pendingAfterChat = await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending||null)`, worldId);
const ledgerB = await panel.evaluate(CREDITS);
const ids = new Set((ledgerA.tx || []).map((t) => t.id));
out.viewOnlyCharge = { 新增流水: (ledgerB.tx || []).filter((t) => !ids.has(t.id)) };

// 总结全文：一次请求、恰好一条 chat 流水
const boxSum = await railBox('总结全文');
out.boxSum = boxSum;
const ledgerBefore = await panel.evaluate(CREDITS);
const msgsBefore = out.afterChat?.msgs;
if (boxSum?.hit) await clickBox(boxSum);
await sleep(1500);
out.rightAfterSum = await panel.evaluate(SNAP);
for (let i = 0; i < 50; i += 1) {
  const snap = await panel.evaluate(SNAP);
  out.sumWait = { sec: i + 1, ...(snap || {}) };
  if (snap && !snap.streaming && snap.msgs >= (msgsBefore || 0) + 2) break;
  await sleep(1000);
}
const ledgerAfter = await panel.evaluate(CREDITS);
const before = new Set((ledgerBefore.tx || []).map((t) => t.id));
out.summarizeCharge = {
  之前余额: ledgerBefore.balance, 之后余额: ledgerAfter.balance,
  新增流水: (ledgerAfter.tx || []).filter((t) => !before.has(t.id)),
};
out.threadTail = await panel.evaluate(`(() => [...document.querySelectorAll('#thread .msg')].slice(-2).map((n) => ({ cls: n.className, text: (n.innerText||'').replace(/\\s+/g,' ').slice(0,110) })))()`);
out.ledgerTop = ledgerAfter;

await fs.writeFile('launcher3-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written launcher3-report.json');
panel.close();
fix.close();
process.exit(0);
