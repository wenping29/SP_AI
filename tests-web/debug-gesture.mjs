// 调试划词手势链路：内容脚本 -> 服务端口 -> sidePanel.open
// node debug-gesture.mjs <extensionId>
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
    this.logs = [];
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
        this.logs.push(`${data.params.type}: ${(data.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 200));
      }
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '执行出错').slice(0, 240) };
    return response.result?.result?.value ?? null;
  }

  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());

const fixtureTarget = (await list()).find((t) => /fixture\.html/.test(t.url));
const fixture = new Session(fixtureTarget.webSocketDebuggerUrl);
await fixture.open();
await fixture.send('Page.enable');
await fixture.send('Page.bringToFront');
await fixture.send('Runtime.enable');
await sleep(600);

let worldId = null;
for (const id of fixture.contexts.keys()) {
  if (await fixture.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}

await fixture.evaluate(`chrome.runtime.sendMessage({ type: 'wake' }).then(() => 'awoke').catch(() => 'awoke-fail')`, worldId);
await sleep(1800);

const swTarget = (await list()).find((t) => /worker/.test(t.type) && ((t.url || '').includes(EXT) || !(t.url || '').trim()));
let worker = null;
if (swTarget) {
  worker = new Session(swTarget.webSocketDebuggerUrl);
  await worker.open();
  await worker.send('Runtime.enable');
}
await sleep(400);

const toolbar = await fixture.evaluate(await fs.readFile('expr-toolbar.js', 'utf8'), worldId);
const found = (toolbar.buttons || []).find((item) => item.label === '翻译');
const hit = found ? await fixture.evaluate(
  `(() => { const h = document.elementFromPoint(${found.x}, ${found.y}); return h ? h.tagName + '/' + (h.textContent || '').slice(0, 8) : 'null'; })()`,
  worldId,
) : null;
const clicked = { toolbar, target: found, hit };

const point = found ? { x: found.x, y: found.y } : null;
if (point) {
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, buttons: 0, clickCount: 0 });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
}
await sleep(1500);

const pendingAfter = await fixture.evaluate(`chrome.storage.local.get('pending').then((v) => v.pending || null)`, worldId);
const directSend = await fixture.evaluate(
  `chrome.runtime.sendMessage({ type: 'sp-action', actionId: 'translate', selection: '直接投递测试' }).then(() => 'ok').catch((e) => '失败: ' + e.message)`,
  worldId,
);
await sleep(2000);
const targets = await list();

console.log(JSON.stringify({
  clicked: { target: clicked.target, hit: clicked.hit, barDisplay: clicked.toolbar?.barDisplay, selection: clicked.toolbar?.selectionText },
  openProbe: worker ? await worker.evaluate(`chrome.tabs.query({ url: 'http://127.0.0.1:8899/*' })
    .then((tabs) => tabs[0] ? chrome.sidePanel.open({ windowId: tabs[0].windowId }).then(() => 'open 成功（无手势）').catch((e) => 'open 失败: ' + e.message) : '没找到正文标签页')`) : '无服务端口',
  pendingAfterClick: pendingAfter,
  directSend,
  pendingAfterDirect: await fixture.evaluate(`chrome.storage.local.get('pending').then((v) => v.pending || null)`, worldId),
  panelTargets: (await list()).filter((t) => /sidepanel/.test(t.url)).map((t) => ({ type: t.type, url: t.url.slice(0, 60) })),
  swLogs: worker ? worker.logs : ['没有服务端口'],
}, null, 2));

fixture.close();
worker?.close();
