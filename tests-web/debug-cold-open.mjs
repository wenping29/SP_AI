// A/B：服务端口休眠时，悬浮按钮的点击手势还能不能把侧边栏拉出来
// node debug-cold-open.mjs <extensionId>
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
const panelCount = async () => (await list()).filter((t) => /sidepanel\.html/.test(t.url)).length;
const out = {};

// 面板当前宽度决定页面视口，用它判断侧边栏是否真的停靠了
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

async function railBox(title) {
  return fix.evaluate(`(() => {
    const host = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
    const btn = host?.shadowRoot?.querySelector('.rail button[title="' + ${JSON.stringify(title)} + '"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), innerW: innerWidth };
  })()`, worldId);
}

async function clickBox(box) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0, clickCount: 0 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
}

async function waitPanel(ms = 12000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await panelCount()) return true;
    await sleep(1000);
  }
  return false;
}

// 1. 先关面板，拿到「宽视口 + 面板未停靠」的基线
const sw = (await list()).find((t) => t.type === 'service_worker');
if (sw) {
  const s = new Session(sw.webSocketDebuggerUrl);
  await s.open();
  await s.send('Runtime.enable');
  out.closeTry = await s.evaluate(`(async () => {
    if (!chrome.sidePanel.close) return 'no close api';
    const w = await chrome.windows.getCurrent();
    try { await chrome.sidePanel.close({ windowId: w.id }); return 'closed'; } catch (e) { return String(e && e.message || e); }
  })()`);
  s.close();
} else {
  out.closeTry = '没有服务端口可关面板';
}
await sleep(2000);
out.baseline = { panels: await panelCount(), innerW: (await railBox('打开聊天'))?.innerW };

// 2. 冷启动分支：等服务端口休眠，再点按钮
const wakeProbe = await hasSw();
out.swAliveBeforeIdle = wakeProbe;
for (let i = 0; i < 30 && (await hasSw()); i += 1) await sleep(2000);
out.swAliveAfterIdle = await hasSw();
out.idleWaitSec = out.swAliveAfterIdle ? '仍存活(超时60s)' : '已休眠';
await fix.evaluate(`chrome.storage.local.remove('pending')`, worldId);
const coldBox = await railBox('打开聊天');
out.coldBox = coldBox;
if (coldBox) await clickBox(coldBox);
out.coldPanelAppeared = await waitPanel();
out.coldPending = await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending?v.pending.view||v.pending.actionId:null)`, worldId);

// 3. 热分支：先唤醒服务端口，再点同一个按钮
fix.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, worldId);
await sleep(2500);
out.swAliveBeforeWarmClick = await hasSw();
if (await panelCount()) { out.warmPreexisting = await panelCount(); }
await fix.evaluate(`chrome.storage.local.remove('pending')`, worldId);
const warmBox = await railBox('打开聊天');
out.warmBox = warmBox;
if (warmBox) await clickBox(warmBox);
out.warmPanelAppeared = await waitPanel();
out.warmPending = await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending?v.pending.view||v.pending.actionId:null)`, worldId);
out.warmInnerW = (await railBox('打开聊天'))?.innerW;

await fs.writeFile('cold-open-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written cold-open-report.json');
fix.close();
process.exit(0);
