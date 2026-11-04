// 现场诊断 3：把隐藏页强制唤醒后，trusted click 能不能落到悬浮栏
// node debug-dock3.mjs <extensionId>
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
const fix = new Session(fixT.webSocketDebuggerUrl);
await fix.open();
await fix.send('Page.enable');
await fix.send('Runtime.enable');

let worldId = null;
for (const id of fix.contexts.keys()) {
  if (await fix.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;
out.before = await fix.evaluate(`({ state: document.visibilityState, focus: document.hasFocus() })`, worldId);

out.wake = {};
for (const [method, params] of [['Page.setWebLifecycleState', { state: 'active' }], ['Emulation.setFocusEmulationEnabled', { enabled: true }], ['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }]]) {
  const r = await fix.send(method, params);
  out.wake[method] = r.error ? r.error.message : 'ok';
}
await fix.send('Page.bringToFront').catch(() => null);
await sleep(1200);
out.after = await fix.evaluate(`({ state: document.visibilityState, focus: document.hasFocus() })`, worldId);
out.rafAfter = await fix.evaluate(`new Promise((res)=>{const t0=Date.now();requestAnimationFrame(()=>res(Date.now()-t0));setTimeout(()=>res(-1),800)})`, worldId);

// rAF 是否恢复
out.rafProbe = await fix.evaluate(`new Promise((res)=>{const t0=Date.now();requestAnimationFrame(()=>res(Date.now()-t0));setTimeout(()=>res(-1),1200)})`, worldId);

const box = await fix.evaluate(`(() => { const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail')); const rail=h?.shadowRoot?.querySelector('.rail'); if(!rail) return null; const b=rail.querySelector('button:nth-child(4)'); const r=b.getBoundingClientRect(); globalThis.__ev=[]; rail.addEventListener('click',(e)=>globalThis.__ev.push('rail '+(e.composedPath()[0]?.tagName||'?')),true); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }; })()`, worldId);
out.box = box;
if (box) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...box, buttons: 0, clickCount: 0 });
  await sleep(200);
  await fix.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2500);
  out.events = await fix.evaluate(`globalThis.__ev.slice()`, worldId);
  out.panels = (await list()).filter((t) => /sidepanel/.test(t.url)).length;
  out.innerW = await fix.evaluate(`innerWidth`, worldId);
}

await fs.writeFile('dock3.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written dock3.json');
fix.close();
process.exit(0);
