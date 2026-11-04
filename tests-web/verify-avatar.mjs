// 头像账户浮层验证：重载扩展 → 重新停靠面板 → 顶部条已消失 / 头像在右下角 / 悬浮出弹框 / 菜单与充值可用
import fs from 'node:fs/promises';
const DEBUG = 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8899/fixture.html';
const EXT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url); this.nextId = 0; this.pending = new Map(); this.contexts = new Map();
    this.ws.addEventListener('message', (e) => {
      const d = JSON.parse(e.data);
      if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
      if (d.method === 'Runtime.executionContextCreated') this.contexts.set(d.params.context.id, d.params.context);
    });
  }
  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(method, params) { const id = ++this.nextId; this.ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((r) => this.pending.set(id, r)); }
  async evaluate(expression, contextId) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, contextId });
    if (r.error) return { __cdp: r.error.message };
    const d = r.result?.exceptionDetails;
    if (d) return { __error: (d.exception?.description || d.text || '').slice(0, 240) };
    return r.result?.result?.value ?? null;
  }
  async wake() {
    await this.send('Page.enable').catch(() => null);
    await this.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  }
  async shot(f) { const r = await this.send('Page.captureScreenshot', { format: 'png' }).catch(() => null); if (r?.result?.data) { await fs.writeFile(f, Buffer.from(r.result.data, 'base64')); return true; } return false; }
  close() { this.ws.close(); }
}
const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const panels = async () => (await list()).filter((t) => /sidepanel\.html/.test(t.url) && t.webSocketDebuggerUrl);

async function connect(t) { const s = new Session(t.webSocketDebuggerUrl); await s.open().catch(() => null); await s.send('Runtime.enable').catch(() => null); await s.wake(); await sleep(250); return s; }
async function findDocked() {
  for (const t of await panels()) {
    const s = await connect(t);
    const w = await s.evaluate('innerWidth');
    if (w < 600) return s;
    s.close();
  }
  return null;
}

const out = { steps: [] };

// 1) 先重载扩展，让新的 html/css/js 生效
const beforePanel = await findDocked() || (await panels())[0];
if (beforePanel) { try { const s = await connect(beforePanel); s.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()', returnByValue: true }); s.close(); out.steps.push('reload-sent'); } catch (e) { out.steps.push('reload-skipped:' + String(e).slice(0, 80)); } }
await sleep(3000);

// 2) 内容脚本要跟着页面刷新才有悬浮栏；用可信点击「打开聊天」重新停靠
let page = (await list()).find((t) => /fixture\.html/.test(t.url))
  || (await list()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl && /^https?:/.test(t.url || '') && !/sidepanel/.test(t.url));
if (!page) { out.fatal = '没有可用页面目标'; await fs.writeFile('avatar-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
out.hostUrl = page.url;
const fix = await connect(page);
await fix.send('Page.bringToFront').catch(() => null);
await fix.wake();
await sleep(600);

async function findWorld() {
  for (const id of fix.contexts.keys()) {
    if ((await fix.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id)) === EXT) return id;
  }
  return null;
}
const launcherProbe = `(() => { const hosts=[...document.documentElement.children].reverse(); const h=hosts.find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail')); const b=h?.shadowRoot?.querySelector('.rail button[data-tip="打开聊天"]'); const r=b?.getBoundingClientRect(); return r?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),found:Boolean(b)}:{found:false}; })()`;
let world = await findWorld();
let box = world ? await fix.evaluate(launcherProbe, world) : { found: false };
if (!box?.found) {
  // 扩展重载后内容脚本会被孤立，原地刷新这个标签页重新注入
  await fix.send('Page.navigate', { url: page.url });
  await sleep(4000);
  await fix.wake();
  world = await findWorld();
  box = world ? await fix.evaluate(launcherProbe, world) : { found: false };
}
out.launcherBox = box;
out.worldFound = Boolean(world);
if (box?.found) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0, clickCount: 0 });
  await sleep(150);
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
}
let panel = null;
for (let i = 0; i < 15; i += 1) { await sleep(1000); panel = await findDocked(); if (panel) break; }
if (!panel) { out.fatal = '面板没能停靠'; await fs.writeFile('avatar-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
out.steps.push('docked');

// 3) 结构断言
out.layout = await panel.evaluate(`(() => {
  const pop = document.getElementById('accountPop');
  const av = document.getElementById('avatar');
  const ar = av.getBoundingClientRect();
  return JSON.stringify({
    headerGone: !document.querySelector('header') && !document.getElementById('balance'),
    statusInSendbar: document.getElementById('status').closest('.sendbar') ? true : false,
    statusText: document.getElementById('status').textContent,
    avatar: { x: Math.round(ar.left), y: Math.round(ar.top), w: Math.round(ar.width), rightGap: Math.round(innerWidth - ar.right), bottomGap: Math.round(innerHeight - ar.bottom) },
    avatarHasLogo: Boolean(av.querySelector('img')),
    popHiddenByDefault: getComputedStyle(pop).display,
    balance: document.getElementById('popBalance').textContent,
    device: document.getElementById('popDevice').textContent,
    version: document.getElementById('popVersion').textContent,
    popStatus: document.getElementById('popStatus').textContent,
    menuItems: [...document.querySelectorAll('.pop-item')].map((b) => (b.textContent || '').trim() + '/' + (b.querySelector('svg') ? 'svg' : 'empty')),
    rechargeIcon: document.getElementById('popRecharge').querySelector('svg') ? 'svg' : 'empty',
    rechargeTip: document.getElementById('popRecharge').dataset.tip,
  });
})()`);
out.layout = JSON.parse(out.layout);

// 4) CSS 悬浮：强制 :hover 到 dock，看弹框是否出现
await panel.send('DOM.enable').catch(() => null);
await panel.send('CSS.enable').catch(() => null);
const doc = await panel.send('DOM.getDocument');
const q = await panel.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#avatarDock' });
await panel.send('CSS.forcePseudoState', { nodeId: q.result.nodeId, forcedPseudoClasses: ['hover'] }).catch((e) => { out.forceHoverError = String(e); });
await sleep(200);
out.hoverOpen = await panel.evaluate(`(() => { const p = document.getElementById('accountPop'); const cs = getComputedStyle(p); const r = p.getBoundingClientRect(); return JSON.stringify({ display: cs.display, opacity: cs.opacity, visible: r.width > 100 && r.height > 60, left: Math.round(r.left), bottom: Math.round(innerHeight - r.bottom), inViewport: r.left >= 0 && r.bottom <= innerHeight + 1 }); })()`);
out.hoverOpen = JSON.parse(out.hoverOpen);
await panel.send('CSS.forcePseudoState', { nodeId: q.result.nodeId, forcedPseudoClasses: [] }).catch(() => null);
await sleep(150);
out.hoverClosed = await panel.evaluate(`getComputedStyle(document.getElementById('accountPop')).display`);

// 5) 真实点击头像 → .open；再点「积分明细」→ 对话框带充值块
const avBox = await panel.evaluate(`(() => { const r = document.getElementById('avatar').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: avBox.x, y: avBox.y, buttons: 0, clickCount: 0 });
await sleep(150);
await panel.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: avBox.x, y: avBox.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
await panel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: avBox.x, y: avBox.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(500);
out.clickOpen = await panel.evaluate(`JSON.stringify({ open: document.getElementById('avatarDock').classList.contains('open'), display: getComputedStyle(document.getElementById('accountPop')).display, aria: document.getElementById('avatar').getAttribute('aria-expanded') })`);

const itemBox = await panel.evaluate(`(() => { const r = document.querySelector('.pop-item[data-pop="credits"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width }; })()`);
await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: itemBox.x, y: itemBox.y, buttons: 0, clickCount: 0 });
await sleep(150);
await panel.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: itemBox.x, y: itemBox.y, button: 'left', buttons: 1, clickCount: 1 });
await sleep(80);
await panel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: itemBox.x, y: itemBox.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(1200);
out.creditsDialog = await panel.evaluate(`(() => { const d = document.getElementById('creditsDialog'); return JSON.stringify({ open: d.open, balance: document.getElementById('creditsBalance').textContent, rows: document.querySelectorAll('#transactions li').length, hasRecharge: Boolean(document.querySelector('.recharge')), device: document.getElementById('rechargeDevice').value, popClosed: !document.getElementById('avatarDock').classList.contains('open') }); })()`);
out.creditsDialog = JSON.parse(out.creditsDialog);
await panel.evaluate(`document.getElementById('closeCredits').click()`);
await sleep(300);

// 6) 设置入口 + 移开自动收起
await panel.evaluate(`document.getElementById('avatar').click()`);
await sleep(200);
await panel.evaluate(`document.querySelector('.pop-item[data-pop="settings"]').click()`);
await sleep(300);
out.settingsView = await panel.evaluate(`JSON.stringify({ view: state.view, title: document.getElementById('viewTitle').textContent, popClosed: !document.getElementById('avatarDock').classList.contains('open') })`);

out.shot = await panel.shot('avatar-panel.png');
await fs.writeFile('avatar-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written avatar-report.json');
panel.close();
process.exit(0);
