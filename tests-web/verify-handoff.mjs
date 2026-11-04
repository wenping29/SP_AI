// 验证 sp-action 交接链路：内容脚本 -> 后台 pending -> 面板执行动作 -> 真模型回答扣分
// node verify-handoff.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.contexts = new Map();
    this.consoleLines = [];
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        this.pending.get(data.id)(data);
        this.pending.delete(data.id);
      }
      if (data.method === 'Runtime.executionContextCreated') {
        this.contexts.set(data.params.context.id, data.params.context);
      }
      if (data.method === 'Runtime.consoleAPICalled') {
        this.consoleLines.push(
          `${data.params.type}: ${(data.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 200),
        );
      }
    });
  }

  async open() {
    await new Promise((resolve) => this.ws.addEventListener('open', resolve, { once: true }));
  }

  send(method, params) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  async evaluate(expression, contextId) {
    const response = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, contextId,
    });
    if (response.result?.exceptionDetails) {
      throw new Error((response.result.exceptionDetails.exception?.description || '执行出错').slice(0, 200));
    }
    return response.result.result.value;
  }

  close() { this.ws.close(); }
}

const listTargets = async () => (await (await fetch(`${DEBUG}/json`)).json());

// 1. 面板先以标签页方式就位（chrome.* 特权可用）
const panelUrl = `chrome-extension://${EXT}/sidepanel/sidepanel.html`;
const panelTarget = await (await fetch(`${DEBUG}/json/new?${panelUrl}`, { method: 'PUT' })).json();
await sleep(3000);
const panel = new Session(panelTarget.webSocketDebuggerUrl);
await panel.open();
const panelBefore = await panel.evaluate(await fs.readFile('expr-panel.js', 'utf8'));

// 2. 正文页内容脚本世界
const fixtureTarget = await (await fetch(`${DEBUG}/json/new?http://127.0.0.1:8899/fixture.html`, { method: 'PUT' })).json();
await sleep(3000);
const fixture = new Session(fixtureTarget.webSocketDebuggerUrl);
await fixture.open();
await fixture.send('Runtime.enable', {});
await sleep(600);

let worldId = null;
for (const id of fixture.contexts.keys()) {
  try {
    const value = await fixture.evaluate(
      `(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || ''`, id);
    if (value === EXT) { worldId = id; break; }
  } catch { /* 忽略 */ }
}

// 3. 服务端口日志
const targetsNow = await listTargets();
const sw = targetsNow.find((t) => t.type === 'service_worker' && t.url.includes(EXT));
let worker = null;
if (sw) {
  worker = new Session(sw.webSocketDebuggerUrl);
  await worker.open();
  await worker.send('Runtime.enable', {});
}

// 4. 选中一段英文/中文混合内容，走与浮层按钮相同的消息通路
const selection = '本次版本支持国产大模型切换，采用积分制计费，注册即送 1000 积分。';
const sendExpr = `chrome.runtime.sendMessage({ type: 'sp-action', actionId: 'translate', selection: ${JSON.stringify(selection)} }).then(() => '已投递').catch((e) => '投递失败: ' + e.message)`;
const delivery = worldId === null ? '没有隔离世界' : await fixture.evaluate(sendExpr, worldId);

// 5. 等面板完成动作与流式回答
await sleep(9000);
const panelAfter = await panel.evaluate(await fs.readFile('expr-panel.js', 'utf8'));
const pendingLeft = await panel.evaluate(`chrome.storage.local.get('pending').then((v) => v.pending || null)`);

console.log(JSON.stringify({
  delivery,
  panelBefore: { status: panelBefore.status, balance: panelBefore.balanceChip, messages: panelBefore.messageCount },
  panelAfter: { status: panelAfter.status, balance: panelAfter.balanceChip, messages: panelAfter.messageCount },
  lastTwo: panelAfter.lastTwo,
  pendingLeft,
  workerConsole: worker ? worker.consoleLines : ['无服务端口'],
}, null, 2));

panel.close();
fixture.close();
worker?.close();
