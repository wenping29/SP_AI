// 诊断：悬浮按钮点击后消息是否到达服务端口、sidePanel.open() 到底报了什么
// node debug-launcher.mjs <extensionId>
import fs from 'node:fs/promises';

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
    this.events = [];
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) { this.pending.get(data.id)(data); this.pending.delete(data.id); }
      if (data.method === 'Runtime.executionContextCreated') this.contexts.set(data.params.context.id, data.params.context);
      if (data.method === 'Runtime.consoleAPICalled') {
        this.events.push(`${data.params.type}: ${(data.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 200));
      }
      if (data.method === 'Log.entryAdded') this.events.push(`log:${data.params.entry.text}`.slice(0, 200));
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

// 唤醒并挂上服务端口探针
fix.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, worldId);
await sleep(2000);
const sw = (await list()).find((t) => t.type === 'service_worker');
out.hasSw = !!sw;
let worker = null;
if (sw) {
  worker = new Session(sw.webSocketDebuggerUrl);
  await worker.open();
  await worker.send('Runtime.enable');
  await worker.send('Log.enable').catch(() => null);
  out.swPatch = await worker.evaluate(`(() => {
    const origOpen = chrome.sidePanel.open.bind(chrome.sidePanel);
    chrome.sidePanel.open = (options) => {
      globalThis.__openCalls = (globalThis.__openCalls || 0) + 1;
      globalThis.__openArgs = options;
      return origOpen(options).then(
        () => { globalThis.__openResult = 'ok'; },
        (err) => { globalThis.__openResult = String(err && err.message || err); throw err; }
      );
    };
    globalThis.__msgs = [];
    chrome.runtime.onMessage.addListener((m) => { globalThis.__msgs.push(m && m.type); });
    return 'patched';
  })()`);
}

// 内容脚本侧记录 sendMessage 的入参与返回
out.contentPatch = await fix.evaluate(`(() => {
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  window.__sent = [];
  chrome.runtime.sendMessage = (...args) => {
    window.__sent.push(JSON.parse(JSON.stringify(args[0] || {})));
    const p = orig(...args);
    if (p && p.catch) p.catch((e) => { window.__sendError = String(e && e.message || e); });
    return p;
  };
  const host = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
  const btn = host?.shadowRoot.querySelector('.rail button[title="打开聊天"]');
  const r = btn?.getBoundingClientRect();
  return { hasHost: !!host, hasBtn: !!btn, box: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width } : null,
           hit: r ? (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === host) : null,
           hitTag: r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.tagName : null,
           innerW: innerWidth };
})()`, worldId);

const box = out.contentPatch.box;
if (box) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(box.x), y: Math.round(box.y), buttons: 0, clickCount: 0 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(box.x), y: Math.round(box.y), button: 'left', buttons: 1, clickCount: 1 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(box.x), y: Math.round(box.y), button: 'left', buttons: 0, clickCount: 1 });
}
await sleep(1200);

out.contentAfter = await fix.evaluate(`(() => ({ sent: window.__sent, error: window.__sendError || null }))()`, worldId);
if (worker) {
  out.swAfter = await worker.evaluate(`(() => ({ msgs: globalThis.__msgs, openCalls: globalThis.__openCalls || 0, openArgs: globalThis.__openArgs, openResult: globalThis.__openResult || 'never-called' }))()`);
  // 再直接试一次不带手势的 open，看错误文案
  out.rawOpen = await worker.evaluate(`chrome.sidePanel.open({ windowId: 1 }).then(()=>'ok').catch((e)=>String(e && e.message || e))`);
  out.windows = await worker.evaluate(`chrome.windows.getAll().then((w)=>w.map((x)=>({ id: x.id, type: x.type, focused: x.focusWidth||null })))`);
  out.swLogs = worker.events.slice(-12);
}
await sleep(1500);
out.panels = (await list()).filter((t) => /sidepanel/.test(t.url)).map((t) => t.id.slice(0, 8));
out.pendingNow = await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending||null)`, worldId);

await fs.writeFile('launcher-debug.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written launcher-debug.json');
worker?.close();
fix.close();
process.exit(0);
