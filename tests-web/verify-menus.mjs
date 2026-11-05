// 真机验证新增的 7 个功能菜单：重载扩展 -> 打开侧边栏 -> 点每个入口 -> 检查面板显隐与图标
// node verify-menus.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        this.pending.get(data.id)(data);
        this.pending.delete(data.id);
      }
    });
  }

  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }

  send(method, params) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => this.pending.set(id, r));
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (response.error) return { __cdp: (response.error.message || JSON.stringify(response.error)).slice(0, 200) };
    const detail = response.result?.exceptionDetails;
    if (detail) return { __error: (detail.exception?.description || detail.text || '执行出错').slice(0, 300) };
    return response.result?.result?.value ?? null;
  }

  close() { this.ws.close(); }
}

const report = {};
const views = ['code', 'hand', 'notes', 'create', 'write', 'ocr', 'pdf'];
const allViews = ['chat', 'ask', 'translate', ...views.slice(0, 7), 'tools', 'settings'];

// 0. 重载扩展，确保跑磁盘上的新代码
const targets = await (await fetch(`${DEBUG}/json`)).json();
const reloader = targets.find((t) => t.url.includes(EXT)) || targets.find((t) => t.type === 'service_worker');
if (reloader) {
  const session = new Session(reloader.webSocketDebuggerUrl);
  await session.open();
  report.reload = await session.evaluate('(()=>{ chrome.runtime.reload(); return "已触发重载"; })()');
  await sleep(3000);
  session.close();
}
for (const target of await (await fetch(`${DEBUG}/json`)).json()) {
  if (/sidepanel\.html/.test(target.url)) await fetch(`${DEBUG}/json/close/${target.id}`).catch(() => {});
}
await sleep(1500);

// 1. 打开侧边栏页面
let panel;
for (const wait of [4000, 6000, 9000]) {
  const target = await (await fetch(`${DEBUG}/json/new?chrome-extension://${EXT}/sidepanel/sidepanel.html`, { method: 'PUT' })).json();
  await sleep(wait);
  const session = new Session(target.webSocketDebuggerUrl);
  await session.open();
  const probe = await session.evaluate('document.readyState');
  if (typeof probe === 'string') { panel = session; break; }
  session.close();
  await fetch(`${DEBUG}/json/close/${target.id}`).catch(() => {});
  await sleep(1500);
}
if (!panel) throw new Error('面板起不来');

// 2. 入口是否都在导航里，图标是否 hydrated
report.entries = await panel.evaluate(`(() => ({
  railCount: document.querySelectorAll('#rail button[data-view]').length,
  navCount: document.querySelectorAll('#navGrid button[data-view]').length,
  railMissing: ${JSON.stringify(views)}.filter((v) => !document.querySelector('#rail button[data-view="' + v + '"] svg')),
  navMissing: ${JSON.stringify(views)}.filter((v) => !document.querySelector('#navGrid button[data-view="' + v + '"] svg')),
  panesMissing: ${JSON.stringify(views)}.filter((v) => !document.getElementById(v + 'View')),
  fallbackIcons: ${JSON.stringify(views)}.filter((v) => {
    const el = document.querySelector('#rail button[data-view="' + v + '"] svg');
    return !el || el.innerHTML.indexOf('path') < 0;
  }),
}))()`);

// 3. 逐个点击 rail 入口，检查只有对应面板可见、按钮高亮、占位文案渲染
report.clicks = [];
for (const view of views) {
  await panel.evaluate(`document.querySelector('#rail button[data-view="${view}"]').click()`);
  await sleep(250);
  const state = await panel.evaluate(`(() => ({
    view: state.view,
    shown: ${JSON.stringify(allViews)}.filter((name) => !document.getElementById(name + 'View').hidden),
    activeRail: [...document.querySelectorAll('#rail button[data-view].active')].map((b) => b.dataset.view),
    activeNav: [...document.querySelectorAll('#navGrid button[data-view].active')].map((b) => b.dataset.view),
    emptyText: document.getElementById('${view}View').querySelector('.pane-empty')?.textContent.trim().slice(0, 40),
    emptyIcon: Boolean(document.getElementById('${view}View').querySelector('.pane-empty svg')),
  }))()`);
  report.clicks.push({ view, ...state });
}

// 4. rail 在短窗口下是否溢出（新增 12 个入口后）
report.rail = await panel.evaluate(`(() => {
  const rail = document.getElementById('rail');
  return { clientHeight: rail.clientHeight, scrollHeight: rail.scrollHeight, scrollable: getComputedStyle(rail).overflowY };
})()`);

// 5. 折叠态导航（navMenu）也能进新页面
report.collapsedNav = await panel.evaluate(`(() => {
  document.getElementById('navToggle').click();
  const btn = document.querySelector('#navGrid button[data-view="ocr"]');
  btn.click();
  return { navHidden: document.getElementById('navMenu').hidden, ocrShown: !document.getElementById('ocrView').hidden, view: state.view };
})()`);

await panel.evaluate(`document.querySelector('#rail button[data-view="chat"]').click()`);
report.backToChat = await panel.evaluate('state.view');

console.log(JSON.stringify(report, null, 2));
await fs.writeFile('menu-report.json', JSON.stringify(report, null, 2));
panel.close();
