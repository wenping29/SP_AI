// 冒烟：重载扩展 -> 打开面板 -> 检查启动状态与控件渲染
// node verify-boot.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        this.pending.get(data.id)(data);
        this.pending.delete(data.id);
      }
    });
  }

  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }

  send(method, params) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => this.pending.set(id, r));
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const detail = response.result?.exceptionDetails;
    if (detail) return { __error: (detail.exception?.description || detail.text || '执行出错').slice(0, 400) };
    return response.result.result.value;
  }

  close() { this.ws.close(); }
}

// 先用现存的扩展页面触发重载（重载后 Chrome 会关掉这些页面），再清残留标签页
const opener = await (await fetch(`${DEBUG}/json`)).json();
const helper = opener.find((t) => t.url.includes(EXT)) || opener.find((t) => t.type === 'service_worker');
if (helper) {
  const session = new Session(helper.webSocketDebuggerUrl);
  await session.open();
  console.log('reload:', await session.evaluate('(()=>{ chrome.runtime.reload(); return "已触发重载"; })()'));
  await sleep(3000);
  session.close();
}

for (const target of await (await fetch(`${DEBUG}/json`)).json()) {
  if (target.url.includes(EXT) || /fixture\.html/.test(target.url)) {
    await fetch(`${DEBUG}/json/close/${target.id}`).catch(() => {});
  }
}
await sleep(1000);

const target = await (await fetch(`${DEBUG}/json/new?chrome-extension://${EXT}/sidepanel/sidepanel.html`, { method: 'PUT' })).json();
await sleep(5000);
const panel = new Session(target.webSocketDebuggerUrl);
await panel.open();
console.log(JSON.stringify({
  boot: await panel.evaluate(await fs.readFile('expr-ui-boot.js', 'utf8')),
  errors: await panel.evaluate('window.__bootError || null'),
}, null, 2));
panel.close();
