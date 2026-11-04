// 右侧悬浮快捷栏：重载扩展 -> 栏几何 -> 四个按钮逐个验证视图切换与扣费 -> 开关实时隐藏
// node verify-launcher.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = process.env.CDP || 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8899/fixture.html';
const PANEL_URL = `chrome-extension://${EXT}/sidepanel/sidepanel.html`;
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 240) };
    return response.result?.result?.value ?? null;
  }
  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const out = {};

// 1. 重载扩展，让新的 background.js / content/page.js 真的生效
const sw = (await list()).find((t) => t.type === 'service_worker');
if (sw) {
  const s = new Session(sw.webSocketDebuggerUrl);
  await s.open();
  s.send('Runtime.evaluate', { expression: 'chrome.runtime.reload(); "sent"' });
  out.reload = 'via service worker';
} else {
  const t = await (await fetch(`${DEBUG}/json/new?${PANEL_URL}`, { method: 'PUT' })).json();
  const s = new Session(t.webSocketDebuggerUrl);
  await s.open();
  s.send('Runtime.evaluate', { expression: 'chrome.runtime.reload(); "sent"' });
  out.reload = 'via panel tab';
}
await sleep(9000);

// 2. 清场：关掉所有面板实例，停靠后 target 数量才是唯一信号
for (const t of await list()) {
  if (/sidepanel\.html/.test(t.url)) await fetch(`${DEBUG}/json/close/${t.id}`).catch(() => {});
}
await sleep(1500);

// 3. fixture 页 + 内容脚本 isolated world
const existing = (await list()).find((t) => /fixture\.html/.test(t.url));
const fixTarget = existing || await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json();
const fix = new Session(fixTarget.webSocketDebuggerUrl);
await fix.open();
await fix.send('Page.enable');
await fix.send('Page.navigate', { url: FIXTURE });
await sleep(3500);
await fix.send('Page.bringToFront');
await fix.send('Runtime.enable');
await sleep(1000);

let worldId = null;
for (const id of fix.contexts.keys()) {
  if (await fix.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;

const RAIL_EXPR = `(() => {
  const host = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
  if (!host) return { found: false, children: [...document.documentElement.children].map((n) => n.tagName) };
  const rail = host.shadowRoot.querySelector('.rail');
  const btns = [...rail.querySelectorAll('button')].map((b) => {
    const r = b.getBoundingClientRect();
    return { title: b.title, primary: b.classList.contains('primary'), ring: getComputedStyle(b).boxShadow.includes('123, 63, 228') || getComputedStyle(b).boxShadow.includes('rgb(123, 63, 228)'),
             x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), svg: !!b.querySelector('svg') };
  });
  const box = rail.getBoundingClientRect();
  return { found: true, hidden: rail.hidden, count: btns.length, btns, innerW: innerWidth, innerH: innerHeight,
           竖排: btns.every((b, i, a) => i === 0 || b.y > a[i - 1].y),
           全部40圆角: btns.every((b) => b.w === 40 && b.h === 40 && !!b.svg),
           贴右: btns.every((b) => Math.abs(b.x + b.w / 2 - (innerWidth - 10)) <= 2),
           整体居中: Math.abs((box.top + box.height / 2) - innerHeight / 2) <= 30,
           标题: btns.map((b) => b.title) };
})()`;

async function rail() { return fix.evaluate(RAIL_EXPR, worldId); }

async function clickAt(x, y) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function clickRail(title) {
  const state = await rail();
  const btn = (state.btns || []).find((b) => b.title === title);
  if (!btn) return { error: `没找到按钮 ${title}`, rail: state };
  await clickAt(btn.x, btn.y);
  return { clicked: btn };
}

const PANEL_SNAP = `(() => ({
  viewTitle: document.querySelector('#viewTitle')?.textContent,
  activeRail: document.querySelector('#rail button.active')?.dataset.view,
  status: document.querySelector('#status')?.textContent?.trim(),
  streaming: !!document.querySelector('#thread .msg.streaming'),
  assistant: document.querySelectorAll('#thread .msg.assistant').length,
  msgs: document.querySelectorAll('#thread .msg').length,
  launcherChecked: document.querySelector('#launcherToggle')?.checked,
}))()`;

async function credits() {
  return panel.evaluate(`(async () => {
    const { server, token } = await chrome.storage.local.get(['server', 'token']);
    const r = await fetch(server + '/api/credits', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    return { balance: j.balance, tx: (j.transactions || []).slice(0, 6) };
  })()`);
}

// 4. 初始栏状态
out.railInitial = await rail();
await fix.evaluate(`chrome.storage.local.remove(['pending', 'launcher'])`, worldId);
await sleep(400);

// 5. 点「打开聊天」：应停靠出面板、切到聊天视图，且不产生扣分
out.clickChat = await clickRail('打开聊天');
let panel = null;
for (let i = 0; i < 14; i += 1) {
  await sleep(1000);
  const panels = (await list()).filter((t) => /sidepanel\.html/.test(t.url));
  if (panels.length) {
    panel = new Session(panels[0].webSocketDebuggerUrl);
    await panel.open().catch(() => null);
    await panel.send('Runtime.enable').catch(() => null);
    await sleep(600);
    out.panelAppearedAfterSec = i + 1;
    break;
  }
}
if (!panel) {
  out.panel = '面板 target 未出现';
  await fs.writeFile('launcher-report.json', JSON.stringify(out, null, 2), 'utf8');
  fix.close();
  process.exit(1);
}
out.afterChatClick = await panel.evaluate(PANEL_SNAP);
out.pendingAfterChat = await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending||null)`, worldId);
out.creditsAfterChat = await credits();

// 6. 视图切换：全部工具 / 划词翻译
out.clickTools = await clickRail('全部工具');
await sleep(900);
out.afterToolsClick = await panel.evaluate(PANEL_SNAP);
out.clickTranslate = await clickRail('划词翻译');
await sleep(900);
out.afterTranslateClick = await panel.evaluate(PANEL_SNAP);

// 7. 总结全文：应切回聊天、发出一次请求、只多一条 chat 流水
const ledgerBefore = await credits();
out.clickSummarize = await clickRail('总结全文');
await sleep(1200);
out.rightAfterSummarize = await panel.evaluate(PANEL_SNAP);
for (let i = 0; i < 45; i += 1) {
  const snap = await panel.evaluate(PANEL_SNAP);
  out.summarizeWait = { sec: i + 1, ...(snap || {}) };
  if (snap && !snap.streaming && snap.assistant >= 1) break;
  await sleep(1000);
}
const ledgerAfter = await credits();
const idBefore = new Set((ledgerBefore.tx || []).map((t) => t.id));
out.summarizeLedger = {
  before: ledgerBefore, after: ledgerAfter,
  新增流水: (ledgerAfter.tx || []).filter((t) => !idBefore.has(t.id)),
};
out.threadTail = await panel.evaluate(`(() => [...document.querySelectorAll('#thread .msg')].slice(-2).map((n) => ({ role: n.className, text: (n.innerText||'').replace(/\\s+/g,' ').slice(0,140) })))()`);

// 8. 开关：设置页勾选框与 storage 互通，且内容脚本免重载实时隐藏
await panel.evaluate(`chrome.storage.local.set({ launcher: false })`);
await sleep(800);
out.toggleOff = { rail: await rail(), panel: await panel.evaluate(PANEL_SNAP) };
await panel.evaluate(`(async () => { await chrome.storage.local.set({ launcher: true }); })()`);
await sleep(800);
out.toggleOn = { rail: await rail(), panel: await panel.evaluate(PANEL_SNAP) };
// 勾选框直接改 storage
await panel.evaluate(`(() => { const c = document.querySelector('#launcherToggle'); c.checked = false; c.dispatchEvent(new Event('change')); return c.checked; })()`);
await sleep(800);
out.toggleViaCheckbox = { railHidden: (await rail()).hidden, storage: await fix.evaluate(`chrome.storage.local.get('launcher').then((v)=>v.launcher)`, worldId) };
await panel.evaluate(`chrome.storage.local.set({ launcher: true })`);
await sleep(600);
out.restored = await rail();

out.railFinal = await rail();
await fs.writeFile('launcher-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written launcher-report.json');
panel.close();
fix.close();
process.exit(0);
