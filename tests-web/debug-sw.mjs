// 看服务端口里真正在跑的 launchAction 源码，判断扩展是否加载了磁盘上的新代码
// node debug-sw.mjs <extensionId>
const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.logs = [];
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) { this.pending.get(data.id)(data); this.pending.delete(data.id); }
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 200) };
    return response.result?.result?.value ?? null;
  }

  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());

const wakeTarget = (await list()).find((t) => /fixture\.html/.test(t.url)) || (await list()).find((t) => t.url.includes(EXT));
if (wakeTarget) {
  const page = new Session(wakeTarget.webSocketDebuggerUrl);
  await page.open();
  page.contexts = new Map();
  page.ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.executionContextCreated') page.contexts.set(data.params.context.id, data.params.context);
  });
  await page.send('Runtime.enable');
  await sleep(700);
  const candidates = wakeTarget.url.includes(EXT) ? [...page.contexts.keys(), undefined] : [...page.contexts.keys()];
  for (const id of candidates) {
    const value = await page.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id);
    if (value === EXT || wakeTarget.url.includes(EXT)) {
      await page.evaluate(`chrome.runtime.sendMessage({ type: 'wake' }).then(()=>'awoke').catch(()=>'awoke-err')`, id);
      break;
    }
  }
  await sleep(1200);
  page.close();
}

const swTarget = (await list()).find((t) => /worker/.test(t.type) && ((t.url || '').includes(EXT) || !(t.url || '').trim()));
if (!swTarget) {
  console.log(JSON.stringify({ found: false, types: (await list()).map((t) => `${t.type}:${(t.url || '').slice(0, 50)}`) }, null, 2));
  process.exit(0);
}

const sw = new Session(swTarget.webSocketDebuggerUrl);
await sw.open();
await sw.send('Runtime.enable');
console.log(JSON.stringify({
  found: true,
  url: swTarget.url,
  hasLaunchAction: await sw.evaluate('typeof launchAction'),
  source: await sw.evaluate('typeof launchAction === "function" ? String(launchAction).slice(0, 700) : null'),
  manifest: await sw.evaluate('chrome.runtime.getManifest ? JSON.stringify({version: chrome.runtime.getManifest().version, host: chrome.runtime.getManifest().host_permissions}) : null'),
  logs: sw.logs,
}, null, 2));
sw.close();
process.exit(0);
