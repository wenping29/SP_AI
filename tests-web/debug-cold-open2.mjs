// A/B v2：面板先真关掉（宽视口基线），再对比「服务端口休眠 / 清醒」两种情况下悬浮按钮能否把面板拉回来
// node debug-cold-open2.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 200) };
    return response.result?.result?.value ?? null;
  }
  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const hasSw = async () => !!(await list()).find((t) => t.type === 'service_worker');
const swSession = async () => {
  const t = (await list()).find((x) => x.type === 'service_worker');
  if (!t) return null;
  const s = new Session(t.webSocketDebuggerUrl);
  await s.open().catch(() => null);
  await s.send('Runtime.enable').catch(() => null);
  return s;
};
const out = {};

const existing = (await list()).find((t) => /fixture\.html/.test(t.url));
const fixTarget = existing || await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json();
const fix = new Session(fixTarget.webSocketDebuggerUrl);
await fix.open();
await fix.send('Page.enable');
await fix.send('Page.navigate', { url: FIXTURE });
await sleep(3000);
await fix.send('Page.bringToFront');
await fix.send('Runtime.enable');
await sleep(800);
let worldId = null;
for (const id of fix.contexts.keys()) {
  if (await fix.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;
if (!worldId) { out.fatal = '找不到内容脚本世界'; await fs.writeFile('cold-open2-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }

async function innerW() { return fix.evaluate(`innerWidth`, worldId); }
async function railBox(title) {
  return fix.evaluate(`(() => {
    const host = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
    const btn = host?.shadowRoot?.querySelector('.rail button[title="' + ${JSON.stringify(title)} + '"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), innerW: innerWidth, hidden: host.shadowRoot.querySelector('.rail').hidden };
  })()`, worldId);
}
async function clickBox(box) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0, clickCount: 0 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
}

async function closePanel() {
  const s = await swSession();
  if (!s) return '没有服务端口';
  const r = await s.evaluate(`(async () => {
    const w = await chrome.windows.getCurrent();
    try { await chrome.sidePanel.close({ windowId: w.id }); return 'closed'; } catch (e) { return String(e && e.message || e); }
  })()`);
  s.close();
  return r;
}

// 一次完整试验：关掉面板 -> （可选）等休眠 -> 点按钮 -> 看视口是否被压窄
async function trial({ wakeFirst, idleFirst }) {
  const rec = {};
  if (wakeFirst) {
    fix.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, worldId);
    await sleep(2500);
  }
  rec.swBeforeClose = await hasSw();
  if (!rec.swBeforeClose) {
    // 关面板也要服务端口，先用 wake 把它拉起来一次（不影响后面「点击时是否休眠」的判定）
    fix.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, worldId);
    await sleep(2500);
  }
  rec.close = await closePanel();
  await sleep(2500);
  rec.innerWAfterClose = await innerW();
  if (idleFirst) {
    for (let i = 0; i < 30 && (await hasSw()); i += 1) await sleep(2000);
  }
  rec.swAtClick = await hasSw();
  await fix.evaluate(`chrome.storage.local.remove('pending')`, worldId);
  const box = await railBox('打开聊天');
  rec.box = box;
  if (box) await clickBox(box);
  rec.dockedWithin12s = false;
  for (let i = 0; i < 12; i += 1) {
    await sleep(1000);
    if ((await innerW()) < 600) { rec.dockedWithin12s = true; rec.afterSec = i + 1; break; }
  }
  rec.innerWFinal = await innerW();
  await sleep(2500);
  rec.pendingResidual = await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending?v.pending.view||v.pending.actionId:null)`, worldId);
  return rec;
}

out.cold = await trial({ wakeFirst: false, idleFirst: true });
out.warm = await trial({ wakeFirst: true, idleFirst: false });

await fs.writeFile('cold-open2-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written cold-open2-report.json');
fix.close();
process.exit(0);
