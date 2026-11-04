// 悬浮快捷栏复核 v2：先重载扩展，再用「窄视口=停靠实例」挑出真正的侧边栏，逐个按钮验证视图切换/扣费/开关
// node verify-launcher2.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = process.env.CDP || 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8899/fixture.html';
const MODEL = process.env.SP_MODEL || 'deepseek-chat';
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
const panelTargets = async () => (await list()).filter((t) => /sidepanel\.html/.test(t.url));
const out = {};

async function connect(target) {
  const s = new Session(target.webSocketDebuggerUrl);
  await s.open().catch(() => null);
  await s.send('Runtime.enable').catch(() => null);
  await sleep(300);
  return s;
}

// 面板实例体检：innerWidth<600 才算停靠实例，独立标签页开的面板宽度是整窗
async function survey(label) {
  const rows = [];
  for (const t of await panelTargets()) {
    const s = await connect(t);
    rows.push({ id: t.id, short: t.id.slice(0, 8), ...(await s.evaluate(`(() => ({
      innerW: innerWidth, viewTitle: document.querySelector('#viewTitle')?.textContent,
      active: document.querySelector('#rail button.active')?.dataset.view,
      msgs: document.querySelectorAll('#thread .msg').length, model: document.querySelector('#model')?.value,
    }))()`) || {}) });
    s.close();
  }
  out[label] = rows;
  return { rows, docked: rows.find((r) => r.innerW < 600) || null };
}

// 1. 重载扩展：先用 fixture 页把服务端口唤醒，再从服务端口 reload（避免再开面板标签页污染实例）
async function setupFixture() {
  const existing = (await list()).find((t) => /fixture\.html/.test(t.url));
  const target = existing || await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json();
  const s = new Session(target.webSocketDebuggerUrl);
  await s.open();
  await s.send('Page.enable');
  await s.send('Page.navigate', { url: FIXTURE });
  await sleep(3500);
  await s.send('Page.bringToFront');
  await s.send('Runtime.enable');
  await sleep(1000);
  let world = null;
  for (const id of s.contexts.keys()) {
    if (await s.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { world = id; break; }
  }
  return { session: s, worldId: world };
}

const boot = await setupFixture();
boot.session.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, boot.worldId);
boot.session.close();
await sleep(2500);

const sw = (await list()).find((t) => t.type === 'service_worker');
if (!sw) { out.fatal = '服务端口没能唤醒，无法重载扩展'; await fs.writeFile('launcher2-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
{
  const s = await connect(sw);
  s.send('Runtime.evaluate', { expression: 'chrome.runtime.reload(); "sent"' });
  out.reload = 'via service worker';
}
await sleep(10000);

// 2. 扩展重载后旧标签页里的内容脚本成了孤儿，必须重新导航才能拿到活的注入环境
const page = await setupFixture();
const fix = page.session;
const worldId = page.worldId;
out.worldId = worldId;

const RAIL_EXPR = `(() => {
  const host = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
  if (!host) return { found: false };
  const rail = host.shadowRoot.querySelector('.rail');
  const btns = [...rail.querySelectorAll('button')].map((b) => {
    const r = b.getBoundingClientRect();
    const s = getComputedStyle(b);
    return { title: b.title, primary: b.classList.contains('primary'), ring: s.boxShadow.includes('123, 63, 228'),
             x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
             w: Math.round(r.width), h: Math.round(r.height), radius: s.borderRadius, svg: !!b.querySelector('svg'), bg: s.backgroundColor };
  });
  const box = rail.getBoundingClientRect();
  return { found: true, hidden: rail.hidden, count: btns.length, btns, innerW: innerWidth, innerH: innerHeight,
           竖排: btns.every((b, i, a) => i === 0 || b.y > a[i - 1].y),
           尺寸: btns.map((b) => b.w + 'x' + b.h),
           贴右: btns.every((b) => Math.abs(b.x + b.w / 2 - (innerWidth - 10)) <= 2),
           居中: Math.abs((box.top + box.height / 2) - innerHeight / 2) <= 30,
           标题: btns.map((b) => b.title) };
})()`;
const rail = () => fix.evaluate(RAIL_EXPR, worldId);

async function clickAt(x, y) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
async function clickRail(title) {
  const state = await rail();
  const btn = (state.btns || []).find((b) => b.title === title);
  if (!btn) return { error: `没找到 ${title}`, rail: state };
  await clickAt(btn.x, btn.y);
  return { at: { x: btn.x, y: btn.y }, primary: btn.primary };
}

const SNAP = `(() => ({
  innerW: innerWidth, viewTitle: document.querySelector('#viewTitle')?.textContent,
  active: document.querySelector('#rail button.active')?.dataset.view,
  status: document.querySelector('#status')?.textContent?.trim(),
  streaming: !!document.querySelector('#thread .msg.streaming'),
  msgs: document.querySelectorAll('#thread .msg').length,
  assistant: document.querySelectorAll('#thread .msg.assistant').length,
  model: document.querySelector('#model')?.value,
  launcherChecked: document.querySelector('#launcherToggle')?.checked,
}))()`;

const CREDITS = `(async () => {
  const { server, token } = await chrome.storage.local.get(['server', 'token']);
  const live = typeof state === 'undefined' ? {} : state;
  const base = live.server || server || 'http://127.0.0.1:5080';
  const t = live.token || token;
  const r = await fetch(base + '/api/credits', { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json();
  return { base, status: r.status, balance: j.balance, tx: (j.transactions || []).slice(0, 8) };
})()`;

// 3. 重载后面板实例体检；没有停靠实例就用「打开聊天」按钮把它召唤出来
const first = await survey('panelsAfterReload');
let docked = first.docked;
if (!docked) {
  out.dockByClick = await clickRail('打开聊天');
  for (let i = 0; i < 12; i += 1) {
    await sleep(1000);
    docked = (await survey('panelsWhileDocking')).docked;
    if (docked) break;
  }
  out.dockedAppeared = docked || null;
}

const targets = await panelTargets();
const panelTarget = targets.find((t) => docked && t.id === docked.id) || targets[0];
if (!panelTarget) { out.fatal = '没有任何面板 target，停靠失败'; await fs.writeFile('launcher2-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
const panel = await connect(panelTarget);
out.panelAttached = panelTarget.id.slice(0, 8);
out.panelIsDocked = !!docked && panelTarget.id === docked.id;

// 用户可能正在同一个窗口里手动点，先记下他的偏好，测完原样还回去
out.savedPrefs = await panel.evaluate(`chrome.storage.local.get(['launcher','model'])`);

// 4. 挑一个真的能用的模型，后面「总结全文」才会真跑起来
await panel.evaluate(`(() => {
  const s = document.querySelector('#model');
  const want = [...s.options].find((o) => o.value === ${JSON.stringify(MODEL)});
  if (want) { s.value = want.value; s.dispatchEvent(new Event('change')); }
  return s.value;
})()`);
await sleep(600);
await panel.evaluate(`chrome.storage.local.remove('pending')`);
await fix.evaluate(`chrome.storage.local.set({ launcher: true })`, worldId);
await sleep(500);
out.railReady = await rail();
out.panelReady = await panel.evaluate(SNAP);

// 5. 三个纯视图按钮：应切视图、消费 pending、不产生任何流水
const ledger0 = await panel.evaluate(CREDITS);
const viewCases = [];
for (const [title, expect] of [['全部工具', '工具'], ['划词翻译', '翻译']]) {
  const click = await clickRail(title);
  await sleep(1000);
  const snap = await panel.evaluate(SNAP);
  const pending = await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending||null)`, worldId);
  viewCases.push({ 按钮: title, 期望视图: expect, click, 面板: snap, pending残留: pending ? pending.view || pending.actionId : null });
}
out.viewCases = viewCases;
const ledger1 = await panel.evaluate(CREDITS);
out.viewOnlyNoCharge = {
  before: ledger0.balance, after: ledger1.balance,
  新增流水: (ledger1.tx || []).filter((t) => !(ledger0.tx || []).some((o) => o.id === t.id)),
};

// 6. 打开聊天（纯视图）：窄视口实例应停在聊天视图
out.clickChat = await clickRail('打开聊天');
await sleep(1000);
out.afterChat = await panel.evaluate(SNAP);

// 7. 总结全文：切回聊天 + 只多一条 chat 流水
const ledgerBefore = await panel.evaluate(CREDITS);
out.clickSummarize = await clickRail('总结全文');
await sleep(1500);
out.rightAfterSummarize = await panel.evaluate(SNAP);
for (let i = 0; i < 50; i += 1) {
  const snap = await panel.evaluate(SNAP);
  out.summarizeWait = { sec: i + 1, ...(snap || {}) };
  if (snap && !snap.streaming && snap.assistant >= (out.rightAfterSummarize?.assistant ?? 0) + 1) break;
  await sleep(1000);
}
const ledgerAfter = await panel.evaluate(CREDITS);
const ids = new Set((ledgerBefore.tx || []).map((t) => t.id));
out.summarizeCharge = {
  之前余额: ledgerBefore.balance, 之后余额: ledgerAfter.balance,
  新增流水: (ledgerAfter.tx || []).filter((t) => !ids.has(t.id)),
};
out.threadTail = await panel.evaluate(`(() => [...document.querySelectorAll('#thread .msg')].slice(-2).map((n) => ({ cls: n.className, text: (n.innerText||'').replace(/\\s+/g,' ').slice(0,120) })))()`);

// 8. 开关：storage 改动免重载实时生效，设置页勾选框双向同步
await panel.evaluate(`chrome.storage.local.set({ launcher: false })`);
await sleep(800);
out.switchOff = { rail: await rail(), panel: await panel.evaluate(SNAP) };
await panel.evaluate(`chrome.storage.local.set({ launcher: true })`);
await sleep(800);
out.switchOn = { rail: await rail(), panel: await panel.evaluate(SNAP) };
await panel.evaluate(`(() => { const c = document.querySelector('#launcherToggle'); c.checked = false; c.dispatchEvent(new Event('change')); return c.checked; })()`);
await sleep(800);
out.switchByCheckbox = { 栏隐藏: (await rail()).hidden, storage: await fix.evaluate(`chrome.storage.local.get('launcher').then((v)=>v.launcher)`, worldId) };
await panel.evaluate(`chrome.storage.local.set({ launcher: true })`);
await sleep(700);
out.finalRail = await rail();
out.finalPanels = await survey('panelsFinal');

// 6. 归还用户偏好：模型与悬浮栏开关都恢复成测试前的值
const prefs = out.savedPrefs || {};
await panel.evaluate(`(async () => {
  const patch = {};
  if ('launcher' in ${JSON.stringify(prefs)}) patch.launcher = ${JSON.stringify(prefs.launcher)};
  else patch.launcher = true;
  if (${JSON.stringify(prefs.model)}) patch.model = ${JSON.stringify(prefs.model)};
  await chrome.storage.local.set(patch);
  const s = document.querySelector('#model');
  if (${JSON.stringify(prefs.model)} && [...s.options].some((o) => o.value === ${JSON.stringify(prefs.model)})) {
    s.value = ${JSON.stringify(prefs.model)}; s.dispatchEvent(new Event('change'));
  }
  return patch;
})()`);
await sleep(700);
out.restoredPrefs = await panel.evaluate(`chrome.storage.local.get(['launcher','model'])`);

await fs.writeFile('launcher2-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written launcher2-report.json');
panel.close();
fix.close();
process.exit(0);
