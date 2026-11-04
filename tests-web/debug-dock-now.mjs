// 现场诊断：悬浮栏点击后 open() 到底有没有被调用、返回什么
// node debug-dock-now.mjs <extensionId>
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
if (!fixT) { out.fatal = '没有 fixture 页'; await fs.writeFile('dock-now.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
const fix = new Session(fixT.webSocketDebuggerUrl);
await fix.open();
await fix.send('Page.enable');
await fix.send('Page.navigate', { url: fixT.url });
await sleep(2500);
await fix.send('Page.bringToFront');
await fix.send('Runtime.enable');
await sleep(700);
let worldId = null;
for (const id of fix.contexts.keys()) {
  if (await fix.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;

fix.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, worldId);
await sleep(1800);
const swT = (await list()).find((t) => t.type === 'service_worker');
out.sw = !!swT;
let worker = null;
if (swT) {
  worker = new Session(swT.webSocketDebuggerUrl);
  await worker.open();
  await worker.send('Runtime.enable');
  await worker.send('Log.enable').catch(() => null);
  out.patch = await worker.evaluate(`(() => {
    const orig = chrome.sidePanel.open.bind(chrome.sidePanel);
    globalThis.__calls = [];
    chrome.sidePanel.open = (o) => {
      globalThis.__calls.push({ args: o, at: Date.now(), userActivation: chrome.runtime.lastError ? 'n/a' : undefined });
      return orig(o).then(() => { globalThis.__calls[globalThis.__calls.length-1].result = 'ok'; },
                           (e) => { globalThis.__calls[globalThis.__calls.length-1].result = String(e && e.message || e); throw e; });
    };
    globalThis.__msgs = [];
    chrome.runtime.onMessage.addListener((m, s) => { globalThis.__msgs.push({ type: m && m.type, view: m && m.view, action: m && m.actionId, tabId: s && s.tab && s.tab.id, windowId: s && s.tab && s.tab.windowId }); });
    return 'patched';
  })()`);
}

const box = await fix.evaluate(`(() => {
  const h = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
  const rail = h?.shadowRoot?.querySelector('.rail');
  const b = rail?.querySelector('button:nth-child(4)');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
  return { x, y, innerW: innerWidth, hidden: rail.hidden, tip: b.dataset.tip, hit: document.elementFromPoint(x, y) === h };
})()`, worldId);
out.box = box;

if (box) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, buttons: 0, clickCount: 0 });
  await sleep(120);
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
}
for (let i = 0; i < 10; i += 1) {
  await sleep(1000);
  out.trace = (out.trace || []).concat([{ sec: i + 1, innerW: await fix.evaluate('innerWidth', worldId), panels: (await list()).filter((t) => /sidepanel/.test(t.url)).length }]);
}
out.calls = worker ? await worker.evaluate(`globalThis.__calls || []`) : null;
out.msgs = worker ? await worker.evaluate(`globalThis.__msgs || []`) : null;
out.options = worker ? await worker.evaluate(`(async () => { const w = await chrome.windows.getLastFocused(); try { return { windowId: w.id, opt: await chrome.sidePanel.getOptions({ windowId: w.id }) }; } catch (e) { return { windowId: w.id, error: String(e && e.message || e) }; } })()`) : null;
out.swBehavior = worker ? await worker.evaluate(`chrome.sidePanel.setOptions({ enabled: true }).then(()=>'ok').catch((e)=>String(e&&e.message||e))`) : null;
out.logs = worker ? worker.logs.slice(-12) : null;
out.pending = await fix.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending||null)`, worldId);
out.windows = worker ? await worker.evaluate(`chrome.windows.getAll().then((ws)=>ws.map((w)=>({ id: w.id, type: w.type, state: w.state, focused: w.focused })))`) : null;

await fs.writeFile('dock-now.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written dock-now.json');
worker?.close();
fix.close();
process.exit(0);
