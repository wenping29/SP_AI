// 图标化复核：控件只剩图标、悬浮气泡出名称、点击仍然可用；顺带截图留证
// node verify-icons.mjs <extensionId>
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 220) };
    return response.result?.result?.value ?? null;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) await fs.writeFile(file, Buffer.from(r.result.data, 'base64'));
    return !!r.result?.data;
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
  await s.send('Page.enable').catch(() => null);
  await sleep(250);
  return s;
}

async function setupFixture() {
  const t0 = (await list()).find((t) => /fixture\.html/.test(t.url));
  const target = t0 || await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json();
  const s = await connect(target);
  await s.send('Page.navigate', { url: FIXTURE });
  await sleep(3000);
  await s.send('Page.bringToFront');
  await sleep(600);
  let world = null;
  for (const id of s.contexts.keys()) {
    if (await s.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { world = id; break; }
  }
  return { session: s, worldId: world };
}

// 1. 重载扩展，让新的 html/css/js 与内容脚本一起生效
const page0 = await setupFixture();
page0.session.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, page0.worldId);
await sleep(2200);
page0.session.close();
const sw = (await list()).find((t) => t.type === 'service_worker');
if (!sw) { out.fatal = '服务端口没醒'; await fs.writeFile('icons-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
{
  const s = await connect(sw);
  s.send('Runtime.evaluate', { expression: 'chrome.runtime.reload(); "sent"' });
}
await sleep(10000);

// 2. fixture 重新导航
const page = await setupFixture();
const fix = page.session, worldId = page.worldId;
out.worldId = worldId;

// 3. 找到停靠面板；没有就用悬浮栏召唤
async function survey() {
  const rows = [];
  for (const t of await panelTargets()) {
    const s = await connect(t);
    rows.push({ id: t.id, ...(await s.evaluate(`(() => ({ innerW: innerWidth, view: document.querySelector('#rail button.active')?.dataset.view, svg: document.querySelectorAll('#rail button svg').length, cssVersion: getComputedStyle(document.querySelector('#rail button')).writingMode }))()`) || {}) });
    s.close();
  }
  return rows.find((r) => r.innerW < 600) || rows[0] || null;
}
let docked = await survey();
if (!docked) {
  const box = await fix.evaluate(`(() => { const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail')); const b=h?.shadowRoot?.querySelector('.rail button[data-tip="打开聊天"]'); const r=b?.getBoundingClientRect(); return r?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}:null; })()`, worldId);
  out.dockBox = box;
  if (box) {
    await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...box, buttons: 0, clickCount: 0 });
    await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', buttons: 1, clickCount: 1 });
    await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', buttons: 0, clickCount: 1 });
  }
  for (let i = 0; i < 12; i += 1) { await sleep(1000); docked = await survey(); if (docked) break; }
}
out.docked = docked;
if (!docked?.id) { out.fatal = '没有面板实例'; await fs.writeFile('icons-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
const panel = await connect((await panelTargets()).find((t) => t.id === docked.id));

// 4. 面板结构断言：图标在、文字没了、原生 title 让位给 data-tip
out.panelStructure = await panel.evaluate(`(() => {
  const info = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { id: el.id || el.dataset.view || el.className, svg: !!el.querySelector('svg'), text: (el.textContent || '').trim(),
             tip: el.dataset.tip || null, nativeTitle: el.getAttribute('title'), w: Math.round(r.width), h: Math.round(r.height),
             display: cs.display, writing: cs.writingMode, visible: r.width > 0 && cs.display !== 'none' }; };
  const rail = [...document.querySelectorAll('#rail button')].map(info);
  const controls = ['btnShot','btnFile','btnReadPage','newChat','openHistory'].map((id) => info(document.getElementById(id)));
  const sendbar = ['send','stop'].map((id) => info(document.getElementById(id)));
  const msgActions = [...document.querySelectorAll('#thread .msg-actions button')].map(info);
  const toolBtns = [...document.querySelectorAll('#tools button')].map((b) => ({ svg: !!b.querySelector('svg'), text: (b.innerText||'').replace(/\\s+/g,' ').trim() }));
  return { rail, controls, sendbar, msgActions, railWidth: Math.round(document.getElementById('rail').getBoundingClientRect().width),
           面板宽: innerWidth, 模型下拉: info(document.getElementById('model')) };
})()`);

out.toolNamesKept = await (async () => {
  await panel.evaluate(`(() => { [...document.querySelectorAll('#rail button')].find((b)=>b.dataset.view==='tools').click(); })()`);
  await sleep(700);
  const r = await panel.evaluate(`(() => ({ view: document.querySelector('#viewTitle').textContent,
    tools: [...document.querySelectorAll('#tools button')].map((b) => ({ svg: !!b.querySelector('svg'), name: b.querySelector('span')?.textContent, desc: b.querySelector('.tool-desc')?.textContent })) })))()`);
  return r;
})();

// 5. 悬浮气泡：真实鼠标移到按钮上，读 ::after 的内容与可见性
async function hoverProbe(target, x, y, selExpr, world) {
  await target.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await sleep(250);
  return target.evaluate(`(() => {
    const el = ${selExpr};
    const after = getComputedStyle(el, '::after');
    const r = el.getBoundingClientRect();
    return { content: after.content, opacity: Number(after.opacity), pos: after.position, writing: after.writingMode,
             box: (() => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; })(),
             innerW: innerWidth, innerH: innerHeight };
  })()`, world);
}

await panel.evaluate(`(() => { [...document.querySelectorAll('#rail button')].find((b)=>b.dataset.view==='chat').click(); })()`);
await sleep(600);
const navBox = await panel.evaluate(`(() => { const b=document.querySelector('#rail button[data-view="chat"]'); const r=b.getBoundingClientRect(); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
out.tipNav = await hoverProbe(panel, navBox.x, navBox.y, `document.querySelector('#rail button[data-view="chat"]')`);
const histBox = await panel.evaluate(`(() => { const b=document.getElementById('openHistory'); const r=b.getBoundingClientRect(); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
out.tipHistory = await hoverProbe(panel, histBox.x, histBox.y, `document.getElementById('openHistory')`);
// 气泡是否被面板边界裁掉
out.tipGeometry = await panel.evaluate(`(() => {
  const b = document.querySelector('#rail button[data-view="chat"]');
  const cs = getComputedStyle(b, '::after');
  return { content: cs.content, width: parseFloat(cs.width) || null, right: cs.right, note: '气泡往左弹，靠 .tip-left 定位' };
})()`);

// 6. 点击仍然可用：用受信任点击切到「翻译」视图
await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: navBox.x, y: navBox.y, buttons: 0, clickCount: 0 });
const trBox = await panel.evaluate(`(() => { const b=document.querySelector('#rail button[data-view="translate"]'); const r=b.getBoundingClientRect(); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
await panel.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...trBox, button: 'left', buttons: 1, clickCount: 1 });
await panel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...trBox, button: 'left', buttons: 0, clickCount: 1 });
await sleep(800);
out.afterNavClick = await panel.evaluate(`(() => ({ title: document.querySelector('#viewTitle').textContent, active: document.querySelector('#rail button.active')?.dataset.view }))()`);

// 7. 悬浮栏也要同款气泡
await fix.evaluate(`chrome.storage.local.set({ launcher: true })`, worldId);
await sleep(700);
const railBtn = await fix.evaluate(`(() => { const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail')); const b=h?.shadowRoot?.querySelector('.rail button'); const r=b?.getBoundingClientRect(); return r?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}:null; })()`, worldId);
out.launcherRail = await fix.evaluate(`(() => {
  const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail'));
  const rail=h.shadowRoot.querySelector('.rail');
  return { hidden: rail.hidden, tips: [...rail.querySelectorAll('button')].map((b)=>({ tip: b.dataset.tip, nativeTitle: b.getAttribute('title'), text: (b.textContent||'').trim(), svg: !!b.querySelector('svg') })) };
})()`, worldId);
if (railBtn) out.tipLauncher = await hoverProbe(fix, railBtn.x, railBtn.y, `(() => { const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail')); return h.shadowRoot.querySelector('.rail button'); })()`, worldId);

// 8. 截图留证
out.shotPanel = await panel.shot('icons-panel.png');
out.shotPage = await fix.shot('icons-page.png');

await fs.writeFile('icons-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written icons-report.json');
panel.close();
fix.close();
process.exit(0);
