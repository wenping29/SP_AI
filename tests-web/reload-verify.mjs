// 确保 Edge 里跑的是磁盘上的扩展代码：重载 + 校验服务端口读取到的 manifest
// node reload-verify.mjs <extensionId>
const [,, EXT] = process.argv;
const DEBUG = process.env.CDP || 'http://127.0.0.1:9333';
const EXPECT_HOST = process.env.EXPECT_HOST || '<all_urls>';
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 200) };
    return response.result?.result?.value ?? null;
  }

  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const pageFor = async (predicate) => {
  const target = (await list()).find(predicate);
  if (!target) return null;
  const session = new Session(target.webSocketDebuggerUrl);
  await session.open();
  await session.send('Runtime.enable');
  await sleep(500);
  return { session, target };
};

const readSw = async () => {
  const target = (await list()).find((t) => /worker/.test(t.type) && ((t.url || '').includes(EXT) || !(t.url || '').trim()));
  if (!target) return null;
  const session = new Session(target.webSocketDebuggerUrl);
  await session.open();
  const host = await session.evaluate('chrome.runtime.getManifest().host_permissions.join()');
  const gesture = await session.evaluate('typeof launchAction === "function" ? String(launchAction) : ""');
  session.close();
  return { host, hasWindowId: /windowId/.test(String(gesture)) };
};

for (let attempt = 1; attempt <= 4; attempt += 1) {
  // 需要有一个扩展页面当载体来触发重载
  let carrier = await pageFor((t) => t.url.includes(EXT));
  if (!carrier) {
    const created = await (await fetch(`${DEBUG}/json/new?chrome-extension://${EXT}/sidepanel/sidepanel.html`, { method: 'PUT' })).json();
    await sleep(3500);
    const session = new Session(created.webSocketDebuggerUrl);
    await session.open();
    carrier = { session, target: created };
  }
  await carrier.session.evaluate('(()=>{ try { chrome.runtime.reload(); return "called"; } catch (e) { return "threw: " + e.message; } })()');
  await sleep(4000);
  carrier.session.close();

  const waker = await pageFor((t) => t.url.includes(EXT));
  if (waker) {
    for (const id of waker.session.contexts.keys()) {
      if (await waker.session.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) {
        await waker.session.evaluate(`chrome.runtime.sendMessage({ type: 'wake' }).catch(()=>{})`, id);
        break;
      }
    }
    await sleep(1200);
    waker.session.close();
  }

  const sw = await readSw();
  if (sw && String(sw.host).includes(EXPECT_HOST) && sw.hasWindowId) {
    console.log(JSON.stringify({ ok: true, attempt, sw }, null, 2));
    process.exit(0);
  }
  console.log(`第 ${attempt} 次重载后：${JSON.stringify(sw)}`);
}
console.log('扩展代码仍未更新，请在 edge://extensions 手动点「重新加载」');
process.exit(1);
