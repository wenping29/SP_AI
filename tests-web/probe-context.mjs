// 点击后 pending 完全没写入：先确认内容脚本上下文是否还是活的扩展
// node probe-context.mjs <extensionId>
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 240) };
    return response.result?.result?.value ?? null;
  }
  close() { this.ws.close(); }
}
const list = async () => (await (await fetch(`${DEBUG}/json`)).json());

const t = (await list()).find((x) => /fixture\.html/.test(x.url));
const fx = new Session(t.webSocketDebuggerUrl);
await fx.open();
await fx.send('Runtime.enable');
await sleep(700);

const out = { contexts: [] };
for (const id of fx.contexts.keys()) {
  const rid = await fx.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id);
  if (rid !== EXT) continue;
  out.worldId = id;
  out.url = await fx.evaluate('location.href', id);
  out.loadedFlag = await fx.evaluate('String(window.__spPageLoaded)', id);
  out.getURL = await fx.evaluate(`(() => { try { return chrome.runtime.getURL('background.js'); } catch (e) { return 'threw: ' + e.message; } })()`, id);
  out.sendProbe = await fx.evaluate(`chrome.runtime.sendMessage({ type: 'sp-action', actionId: 'translate', selection: '手工投递探针' }).then(() => 'ok').catch((e) => '失败: ' + e.message)`, id);
  await sleep(2500);
  out.pendingAfterSend = await fx.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending?v.pending.actionId+'@'+v.pending.windowId:null)`, id);
  out.panelTargets = (await list()).filter((x) => /sidepanel/.test(x.url)).map((x) => x.type + ':' + x.url.slice(0, 60));
}
console.log(JSON.stringify(out, null, 2));
fx.close();
process.exit(0);
