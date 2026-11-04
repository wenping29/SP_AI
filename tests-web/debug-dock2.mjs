// 现场诊断 2：悬浮栏的 trusted click 到底进了哪一层
// node debug-dock2.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0; this.pending = new Map(); this.contexts = new Map(); this.logs = [];
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) { this.pending.get(data.id)(data); this.pending.delete(data.id); }
      if (data.method === 'Runtime.executionContextCreated') this.contexts.set(data.params.context.id, data.params.context);
      if (data.method === 'Runtime.consoleAPICalled') this.logs.push(`${data.params.type}: ${(data.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 200));
      if (data.method === 'Log.entryAdded') this.logs.push(`entry[${data.params.entry.level}]: ${data.params.entry.text}`.slice(0, 200));
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

const fixT = (await list()).find((t) => /fixture\.html/.test(t.url));
if (!fixT) { out.fatal = '没有 fixture 页'; }
const fix = new Session(fixT.webSocketDebuggerUrl);
await fix.open();
await fix.send('Page.enable');
await fix.send('Runtime.enable');
await fix.send('Page.bringToFront');
await sleep(600);

let worldId = null;
for (const id of fix.contexts.keys()) {
  if (await fix.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;
if (worldId === null) {
  out.fatal = '没有内容脚本世界';
  await fs.writeFile('dock2.json', JSON.stringify(out, null, 2), 'utf8');
  process.exit(1);
}

out.vis = await fix.evaluate(`({ state: document.visibilityState, hasFocus: document.hasFocus(), w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`, worldId);

// 记录器：把 click 事件在 按钮 / rail / document 三层的命中情况写进页面全局
out.install = await fix.evaluate(`(() => {
  const h = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
  const rail = h?.shadowRoot?.querySelector('.rail');
  if (!rail) return 'no rail';
  globalThis.__ev = [];
  [...rail.children].forEach((b, i) => b.addEventListener('click', () => globalThis.__ev.push('btn' + i), true));
  rail.addEventListener('click', (e) => globalThis.__ev.push('rail target=' + (e.composedPath()[0]?.tagName || '?')), true);
  document.addEventListener('click', (e) => globalThis.__ev.push('doc ' + e.composedPath().map((n) => n.tagName || n.nodeName || String(n)).slice(0, 3).join('>')), true);
  return { n: rail.children.length, rects: [...rail.children].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }), hidden: rail.hidden };
})()`, worldId);

// SW 端记录消息与 open() 调用
await fix.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, worldId);
await sleep(1500);
const swT = (await list()).find((t) => t.type === 'service_worker');
out.sw = !!swT;
let worker = null;
if (swT) {
  worker = new Session(swT.webSocketDebuggerUrl);
  await worker.open();
  await worker.send('Runtime.enable');
  await worker.send('Log.enable').catch(() => null);
  out.patch = await worker.evaluate(`(() => {
    globalThis.__msgs = [];
    chrome.runtime.onMessage.addListener((m, s) => { globalThis.__msgs.push({ type: m && m.type, view: m && m.view, action: m && m.actionId, windowId: s && s.tab && s.tab.windowId }); return false; });
    globalThis.__calls = [];
    const orig = chrome.sidePanel.open.bind(chrome.sidePanel);
    chrome.sidePanel.open = (o) => { globalThis.__calls.push({ args: o, gesture: undefined, at: Date.now() });
      return orig(o).then((v) => { globalThis.__calls.at(-1).result = 'ok'; return v; }, (e) => { globalThis.__calls.at(-1).result = String(e && e.message || e); throw e; }); };
    return 'patched';
  })()`);
}

const box = await fix.evaluate(`(() => {
  const h = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
  const rail = h.shadowRoot.querySelector('.rail');
  const b = rail.querySelector('button:nth-child(4)');
  const r = b.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  return { x, y, stack: document.elementsFromPoint(x, y).map((n) => n.tagName || n.nodeName).slice(0, 5), topIsHost: document.elementFromPoint(x, y) === h };
})()`, worldId);
out.box = box;

async function trustedClick(x, y) {
  await fix.evaluate(`globalThis.__ev = [] ; 1`, worldId);
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await sleep(150);
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(60);
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1200);
}

out.afterTrusted = [];
for (let i = 0; i < 2; i += 1) {
  await trustedClick(box.x, box.y);
  await sleep(700);
  out.afterTrusted.push({ events: await fix.evaluate(`globalThis.__ev.slice()`, worldId), swMsgs: worker ? await worker.evaluate(`globalThis.__msgs.slice()`) : null, calls: worker ? await worker.evaluate(`globalThis.__calls.slice()`) : null, pending: await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending||null)`, worldId), panels: (await list()).filter((t) => /sidepanel/.test(t.url)).length });
}

// 程序化点击：绕开命中测试，验证 sendMessage -> SW 链路本身是否通（无手势，open 会失败但消息要落到 SW）
out.programmatic = await fix.evaluate(`(() => {
  const h = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
  const b = h.shadowRoot.querySelector('.rail button:nth-child(4)');
  globalThis.__ev = [];
  b.click();
  return globalThis.__ev.slice();
})()`, worldId);
await sleep(1500);
out.afterProgrammatic = { swMsgs: worker ? await worker.evaluate(`globalThis.__msgs.slice()`) : null, calls: worker ? await worker.evaluate(`globalThis.__calls.slice()`) : null, pending: await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending||null)`, worldId) };

out.logs = worker ? worker.logs.slice(-15) : null;
out.panels = (await list()).filter((t) => /sidepanel/.test(t.url)).length;

await fs.writeFile('dock2.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written dock2.json');
worker?.close();
fix.close();
process.exit(0);
