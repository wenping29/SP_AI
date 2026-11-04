// 划词手势 -> 停靠面板：面板 target 出现 + pending 被消费 + 会话里只多一条回答
// node verify-handoff3.mjs <extensionId>
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

async function connectPage(urlFragment, tries = 25) {
  for (let i = 0; i < tries; i += 1) {
    const t = (await list()).find((x) => urlFragment.test(x.url));
    if (t) {
      const s = new Session(t.webSocketDebuggerUrl);
      await s.open().catch(() => null);
      await s.send('Runtime.enable').catch(() => null);
      await sleep(300);
      const probe = await s.evaluate('document.readyState').catch(() => null);
      if (probe && !probe.__cdp) return s;
      s.close();
    }
    await sleep(400);
  }
  return null;
}

// 1. 清场：关掉所有面板实例，保证 pending 只有一个可能的消费者
for (const t of await list()) {
  if (/sidepanel\.html/.test(t.url)) await fetch(`${DEBUG}/json/close/${t.id}`).catch(() => {});
}
await sleep(1500);

// 2. fixture 页 + 划词工具栏
const existing = (await list()).find((t) => /fixture\.html/.test(t.url));
const fixtureTarget = existing || await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json();
const fixture = new Session(fixtureTarget.webSocketDebuggerUrl);
await fixture.open();
await fixture.send('Page.enable');
// 扩展重载后旧标签页里的内容脚本会成为孤儿，必须重新导航才能拿到活的注入环境
await fixture.send('Page.navigate', { url: FIXTURE });
await sleep(4000);
await fixture.send('Page.bringToFront');
await fixture.send('Runtime.enable');
await sleep(800);

let worldId = null;
for (const id of fixture.contexts.keys()) {
  if (await fixture.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;

// 服务端口先唤醒并挂上日志
await fixture.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, worldId);
await sleep(1200);
const swTarget = (await list()).find((t) => t.type === 'service_worker' && (t.url || '').includes(EXT));
let worker = null;
if (swTarget) {
  worker = new Session(swTarget.webSocketDebuggerUrl);
  await worker.open();
  await worker.send('Runtime.enable');
  out.swUrl = swTarget.url;
}

// 3. 基线：面板 target 数量、pending、面板内的 deviceId/token 由后面读
out.panelBefore = (await list()).filter((t) => /sidepanel/.test(t.url)).length;
await fixture.evaluate(`chrome.storage.local.remove('pending')`, worldId);
// 清空会话，线程里的消息数就是这一次划词的直接证据
await fixture.evaluate(`chrome.storage.local.set({ sessions: [], activeSession: null })`, worldId);
await sleep(300);
out.pendingBefore = await fixture.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending||null)`, worldId);

const toolbar = await fixture.evaluate(await (await import('node:fs/promises')).readFile('expr-toolbar.js', 'utf8'), worldId);
out.selection = toolbar.selectionText;
const button = (toolbar.buttons || []).find((item) => item.label === '翻译');
out.button = button || null;

// 4. 受信任的真实点击
if (button) {
  const point = { x: button.x, y: button.y };
  out.hitCheck = await fixture.evaluate(`(() => {
    const el = document.elementFromPoint(${point.x}, ${point.y});
    const host = [...document.documentElement.children].reverse().find((n) => n.tagName === 'DIV' && n.shadowRoot);
    const bar = host?.shadowRoot?.querySelector('.bar');
    return { selLen: String(getSelection()).length, hitTag: el?.tagName, hitIsHost: el === host,
             barShown: bar?.className, barBox: bar ? JSON.stringify(bar.getBoundingClientRect().toJSON()) : null };
  })()`, worldId);
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, buttons: 0, clickCount: 0 });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
  out.pendingJustAfterClick = await fixture.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending?v.pending.actionId:null)`, worldId);
}

out.clickedAt = new Date().toLocaleString('sv');
let panelAtSec = null;
for (let i = 0; i < 15; i += 1) {
  await sleep(1000);
  const panels = (await list()).filter((t) => /sidepanel/.test(t.url));
  if (panels.length && panelAtSec === null) panelAtSec = i + 1;
  const pending = await fixture.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending?v.pending.actionId:null)`, worldId);
  out.trace = (out.trace || []).concat([{ sec: i + 1, panelTargets: panels.length, pending }]);
  if (panelAtSec && pending === null) break;
}

// 6. 连进面板读状态
const panel = await connectPage(/sidepanel\.html/);
if (!panel) {
  out.panel = '面板 target 无法连接';
} else {
  await panel.send('Runtime.enable').catch(() => {});
  await sleep(500);
  out.panel = await panel.evaluate(`(() => {
    const msgs = [...document.querySelectorAll('#thread .msg')].map((n) => ({
      role: n.className.replace(/\\s+/g, ' ').trim(),
      text: (n.innerText || '').replace(/\\s+/g, ' ').slice(0, 80),
    }));
    return {
      viewTitle: document.querySelector('#viewTitle')?.textContent,
      status: document.querySelector('#status')?.textContent?.trim(),
      msgs,
      msgCount: msgs.length,
    };
  })()`);
  out.panelStorage = await panel.evaluate(`chrome.storage.local.get(['pending','sessions']).then((v)=>({
    pending: v.pending || null,
    sessionCount: (v.sessions||[]).length,
    messages: (v.sessions||[]).map((s)=>({title:s.title, n:(s.messages||[]).length, last:(s.messages||[]).slice(-1)[0]?.content?.slice(0,40)}))
  }))`);
  out.panelToken = await panel.evaluate(`chrome.storage.local.get(['server','token','deviceId','model']).then((v)=>v)`);

  // 等回答落地（面板内的 .msg.assistant 出现且不再忙）
  for (let i = 0; i < 30; i += 1) {
    const done = await panel.evaluate(`(() => ({
      busy: !!document.querySelector('#thread .msg.streaming'),
      assistant: [...document.querySelectorAll('#thread .msg.assistant')].length,
      msgs: document.querySelectorAll('#thread .msg').length,
    }))()`);
    out.wait = { sec: i + 1, ...done };
    if (done && done.assistant >= 1 && !done.busy) break;
    await sleep(1000);
  }
  out.threadFinal = await panel.evaluate(`(() => [...document.querySelectorAll('#thread .msg')].map((n)=>({
    role: n.className, text: (n.innerText||'').replace(/\\s+/g,' ').slice(0,120)
  })))()`);

  // 面板自己查账本，最贴近真实扣费
  out.ledger = await panel.evaluate(`(async () => {
    const { server, token } = await chrome.storage.local.get(['server', 'token']);
    const r = await fetch((server || '') + '/api/credits', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    return { status: r.status, balance: j.balance, deviceId: j.deviceId, transactions: (j.transactions || []).slice(0, 8) };
  })()`);
  panel.close();
}

out.swLogs = worker ? worker.logs : ['没有服务端口'];
out.targetsFinal = (await list()).map((t) => `${t.type}:${t.url.slice(0, 60)}`);

console.log(JSON.stringify(out, null, 2));
fixture.close();
worker?.close();
process.exit(0);
