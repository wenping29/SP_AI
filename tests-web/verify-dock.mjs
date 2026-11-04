// 真机验证划词手势打开停靠面板，并抓服务端口志
// node verify-dock.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
if (!EXT) {
  console.error('用法：node verify-dock.mjs <extensionId>');
  process.exit(2);
}

const DEBUG = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.contexts = new Map();
    this.consoleLines = [];
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        this.pending.get(data.id)(data);
        this.pending.delete(data.id);
      }
      if (data.method === 'Runtime.executionContextCreated') {
        this.contexts.set(data.params.context.id, data.params.context);
      }
      if (data.method === 'Runtime.consoleAPICalled') {
        const text = (data.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        this.consoleLines.push(`${data.params.type}: ${text}`.slice(0, 200));
      }
    });
  }

  async open() {
    await new Promise((resolve) => this.ws.addEventListener('open', resolve, { once: true }));
  }

  send(method, params) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  async evaluate(expression, contextId) {
    const response = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, contextId,
    });
    if (response.result?.exceptionDetails) {
      throw new Error((response.result.exceptionDetails.exception?.description || '执行出错').slice(0, 200));
    }
    return response.result.result.value;
  }

  close() { this.ws.close(); }
}

const listTargets = async () => (await (await fetch(`${DEBUG}/json`)).json()).map((t) => ({
  id: t.id, type: t.type, url: t.url, webSocketDebuggerUrl: t.webSocketDebuggerUrl,
}));

const readPendingExpr = `chrome.storage.local.get('pending').then((v) => v.pending || null)`;

const created = await (await fetch(`${DEBUG}/json/new?http://127.0.0.1:8899/fixture.html`, { method: 'PUT' })).json();
await sleep(3500);

const fixture = new Session(created.webSocketDebuggerUrl);
await fixture.open();
await fixture.send('Page.enable', {});
await fixture.send('Page.bringToFront', {});
await fixture.send('Runtime.enable', {});
await sleep(600);

let worldId = null;
for (const id of fixture.contexts.keys()) {
  try {
    const value = await fixture.evaluate(
      `(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || ''`, id);
    if (value === EXT) { worldId = id; break; }
  } catch { /* 忽略 */ }
}
if (worldId === null) {
  console.log(JSON.stringify({ step: '失败', reason: '正文页没有该扩展的隔离世界' }));
  process.exit(3);
}

// 附加到服务端口，抓它的 console
const swTarget = (await listTargets()).find((t) => t.type === 'service_worker' && t.url.includes(EXT));
let worker = null;
if (swTarget) {
  worker = new Session(swTarget.webSocketDebuggerUrl);
  await worker.open();
  await worker.send('Runtime.enable', {});
} else {
  // 服务端口可能已休眠，先由内容脚本发一条消息把它唤醒
  await fixture.evaluate(`chrome.runtime.sendMessage({ type: 'wake' }).catch(() => {})`, worldId);
  await sleep(1200);
}

const toolbar = await fixture.evaluate(await fs.readFile('expr-toolbar.js', 'utf8'), worldId);
const button = toolbar.buttons?.find((item) => item.label === '翻译');
const beforeIds = new Set((await listTargets()).map((item) => item.id));

if (button) {
  const point = { x: button.x, y: button.y, buttons: 'left', clickCount: 1 };
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
}

await sleep(300);
const pendingRightAfterClick = await fixture.evaluate(readPendingExpr, worldId).catch(() => '读取失败');

await sleep(5000);

const after = await listTargets();
const newPanels = after.filter((t) => !beforeIds.has(t.id) && t.url.includes('sidepanel/sidepanel.html'));

const panelReports = [];
for (const panel of newPanels) {
  const session = new Session(panel.webSocketDebuggerUrl);
  await session.open();
  try {
    panelReports.push({
      targetId: panel.id.slice(0, 8),
      state: await session.evaluate(await fs.readFile('expr-panel.js', 'utf8')),
      pendingNow: await session.evaluate(readPendingExpr),
    });
  } catch (error) {
    panelReports.push({ targetId: panel.id.slice(0, 8), error: String(error.message) });
  }
  session.close();
}

console.log(JSON.stringify({
  toolbarVisible: toolbar.barDisplay,
  selectionAtClick: toolbar.selectionText,
  clickedAt: button ? { x: button.x, y: button.y } : null,
  pendingRightAfterClick,
  newPanelTargets: newPanels.map((t) => t.id.slice(0, 8)),
  panelReports,
  workerConsole: worker ? worker.consoleLines : ['未找到服务端口'],
}, null, 2));

worker?.close();
fixture.close();
