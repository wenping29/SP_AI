// 收尾：把 launcher 恢复成开启，确认悬浮栏可见 + 面板停靠状态
const DEBUG = 'http://127.0.0.1:9333';
const EXT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class S {
  constructor(u) { this.ws = new WebSocket(u); this.i = 0; this.p = new Map(); this.ctx = new Map();
    this.ws.addEventListener('message', (e) => { const d = JSON.parse(e.data);
      if (d.id && this.p.has(d.id)) { this.p.get(d.id)(d); this.p.delete(d.id); }
      if (d.method === 'Runtime.executionContextCreated') this.ctx.set(d.params.context.id, d.params.context); }); }
  open() { return new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }
  send(m, pr) { const id = ++this.i; this.ws.send(JSON.stringify({ id, method: m, params: pr || {} })); return new Promise((r) => this.p.set(id, r)); }
  async ev(x, c) { const r = await this.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, contextId: c });
    if (r.error) return { __cdp: r.error.message };
    const d = r.result?.exceptionDetails; if (d) return { __error: (d.exception?.description || d.text || '').slice(0, 200) };
    return r.result?.result?.value ?? null; }
  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const out = {};

const fix = (await list()).find((t) => /fixture\.html/.test(t.url));
const panelT = (await list()).find((t) => /sidepanel\.html/.test(t.url));
const p = new S(panelT.webSocketDebuggerUrl);
await p.open();
await p.send('Runtime.enable');
out.panelBefore = await p.ev(`(() => ({ innerW: innerWidth, view: document.querySelector('#rail button.active')?.dataset.view, model: document.querySelector('#model')?.value, msgs: document.querySelectorAll('#thread .msg').length }))()`);
out.storageBefore = await p.ev(`chrome.storage.local.get(['launcher','model','activeSession','pending']).then((v)=>({launcher:v.launcher,model:v.model,pending:v.pending&&v.pending.at}))`);
await p.ev(`(async () => { await chrome.storage.local.remove('pending'); await chrome.storage.local.set({ launcher: true }); })()`);
await sleep(900);
out.storageAfter = await p.ev(`chrome.storage.local.get(['launcher','model']).then((v)=>v)`);
out.settingsCheckbox = await p.ev(`(() => { const c = document.querySelector('#launcherToggle'); return { checked: c?.checked }; })()`);
p.close();

if (fix) {
  const f = new S(fix.webSocketDebuggerUrl);
  await f.open();
  await f.send('Runtime.enable');
  await sleep(500);
  let world = null;
  for (const id of f.ctx.keys()) {
    if (await f.ev(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { world = id; break; }
  }
  out.railNow = await f.ev(`(() => {
    const host = [...document.documentElement.children].reverse().find((n) => n.shadowRoot && n.shadowRoot.querySelector('.rail'));
    const rail = host?.shadowRoot?.querySelector('.rail');
    if (!rail) return { found: false };
    const b = rail.querySelector('button').getBoundingClientRect();
    return { found: true, hidden: rail.hidden, count: rail.querySelectorAll('button').length, firstBox: [Math.round(b.width), Math.round(b.height)], innerW: innerWidth };
  })()`, world);
  f.close();
}
console.log(JSON.stringify(out, null, 1));
process.exit(0);
