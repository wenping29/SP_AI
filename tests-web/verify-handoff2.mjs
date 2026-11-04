// 划词手势 -> 停靠面板：分别观察「是否出现面板 target」与「pending 是否被面板消费」
// node verify-handoff2.mjs <extensionId>
const [,, EXT] = process.argv;
const DEBUG = process.env.CDP || 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8899/fixture.html';
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
      if (data.id && this.pending.has(data.id)) { this.pending.get(data.id)(data); this.pending.delete(data.id); }
      if (data.method === 'Runtime.executionContextCreated') this.contexts.set(data.params.context.id, data.params.context);
      if (data.method === 'Runtime.consoleAPICalled') {
        this.logs.push(`${data.params.type}: ${(data.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 180));
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 220) };
    return response.result?.result?.value ?? null;
  }

  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const out = {};

// 先保证没有任何面板实例（标签页形式）在场，否则谁消费 pending 就说不清了
for (const t of await list()) {
  if (/sidepanel\.html/.test(t.url)) await fetch(`${DEBUG}/json/close/${t.id}`).catch(() => {});
}
await sleep(1500);

const existing = (await list()).find((t) => t.url === FIXTURE || /fixture\.html/.test(t.url));
const fixtureTarget = existing || await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json();
if (!existing) await sleep(4000);
const fixture = new Session(fixtureTarget.webSocketDebuggerUrl);
await fixture.open();
await fixture.send('Page.enable');
await fixture.send('Page.bringToFront');
await fixture.send('Runtime.enable');
await sleep(800);

let worldId = null;
for (const id of fixture.contexts.keys()) {
  if (await fixture.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;

await fixture.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, worldId);
await sleep(1500);
const swTarget = (await list()).find((t) => /worker/.test(t.type) && ((t.url || '').includes(EXT) || !(t.url || '').trim()));
let worker = null;
if (swTarget) {
  worker = new Session(swTarget.webSocketDebuggerUrl);
  await worker.open();
  await worker.send('Runtime.enable');
  out.swUrl = swTarget.url;
}

await fixture.evaluate(`chrome.storage.local.remove('pending')`, worldId);
const windowsBefore = await fixture.evaluate(`chrome.windows.getAll().then((w)=>w.map((x)=>({id:x.id,type:x.type})))`, worldId);
out.windowsBefore = windowsBefore;

const toolbar = await fixture.evaluate(await (await import('node:fs/promises')).readFile('expr-toolbar.js', 'utf8'), worldId);
out.selection = toolbar.selectionText;
const button = (toolbar.buttons || []).find((item) => item.label === '翻译');
out.button = button || null;

if (button) {
  const point = { x: button.x, y: button.y, button: 'left', clickCount: 1 };
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y, buttons: 0, clickCount: 0 });
  await fixture.send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed', buttons: 1 });
  await fixture.send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased', buttons: 0 });
}

const trace = [];
for (let i = 0; i < 12; i += 1) {
  await sleep(1000);
  const targets = await list();
  const panelTargets = targets.filter((t) => /sidepanel/.test(t.url)).map((t) => `${t.type}:${t.url.slice(0, 55)}`);
  const pending = await fixture.evaluate(`chrome.storage.local.get('pending').then((v) => v.pending ? v.pending.actionId + '@' + v.pending.windowId : null)`, worldId);
  const windows = await fixture.evaluate(`chrome.windows.getAll().then((w)=>w.map((x)=>x.type))`, worldId);
  trace.push({ sec: i + 1, panelTargets, pending, windows });
  if (pending === null && i >= 1) break;
}
out.trace = trace;
out.windowsAfter = await fixture.evaluate(`chrome.windows.getAll().then((w)=>w.map((x)=>({id:x.id,type:x.type})))`, worldId);
out.swLogs = worker ? worker.logs : ['没有服务端口'];
out.targetsFinal = (await list()).map((t) => `${t.type}:${t.url.slice(0, 55)}`);

console.log(JSON.stringify(out, null, 2));
fixture.close();
worker?.close();
process.exit(0);
