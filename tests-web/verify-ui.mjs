// 真机验证新面板：视图切换、Composer 控件（模型/截图/附加文件/阅读此页）、消息控件、历史与新聊天
// node verify-ui.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
const TEXT_FILE = 'D:\\Project\\sp\\tests-web\\fixture.html';
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
    const response = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (response.error) return { __cdp: (response.error.message || JSON.stringify(response.error)).slice(0, 200) };
    const detail = response.result?.exceptionDetails;
    if (detail) return { __error: (detail.exception?.description || detail.text || '执行出错').slice(0, 300) };
    return response.result?.result?.value ?? null;
  }

  async dom(method, params) {
    const response = await this.send(method, params);
    if (response.error) throw new Error(`${method}: ${response.error.message}`);
    return response.result;
  }

  close() { this.ws.close(); }
}

const fromFile = async (name) => fs.readFile(name, 'utf8');
const openTarget = async (url) => (await (await fetch(`${DEBUG}/json/new?${url}`, { method: 'PUT' })).json());
const report = {};

async function connectPage(url, { waits = [4000, 6000, 9000] } = {}) {
  for (const wait of waits) {
    const target = await openTarget(url);
    await sleep(wait);
    const session = new Session(target.webSocketDebuggerUrl);
    await session.open();
    const probe = await session.evaluate('document.readyState');
    if (probe !== undefined && typeof probe === 'string') return { session, target };
    session.close();
    await fetch(`${DEBUG}/json/close/${target.id}`).catch(() => {});
    await sleep(1500);
  }
  throw new Error('面板起不来');
}

// 0. 用扩展页面触发 chrome.runtime.reload()，确保跑的是磁盘上的新代码，然后清掉残留标签页
const trigger = await (await fetch(`${DEBUG}/json`)).json();
const reloader = trigger.find((t) => t.url.includes(EXT)) || trigger.find((t) => t.type === 'service_worker');
if (reloader) {
  const session = new Session(reloader.webSocketDebuggerUrl);
  await session.open();
  report.reload = await session.evaluate('(()=>{ chrome.runtime.reload(); return "已触发重载"; })()');
  await sleep(3000);
  session.close();
}
for (const target of await (await fetch(`${DEBUG}/json`)).json()) {
  if (/sidepanel\.html|fixture\.html/.test(target.url)) {
    await fetch(`${DEBUG}/json/close/${target.id}`).catch(() => {});
  }
}
await sleep(1200);

// 1. 没有设备号时清空 storage，用新设备从 200 体验积分开始算账
let first = await connectPage(`chrome-extension://${EXT}/sidepanel/sidepanel.html`);
let panel = first.session;
report.cleared = await panel.evaluate(
  `state.deviceId ? '沿用 ' + state.deviceId : chrome.storage.local.clear().then(() => '已清空，改用新设备')`,
);
if (/清空/.test(String(report.cleared))) {
  panel.close();
  await fetch(`${DEBUG}/json/close/${first.target.id}`).catch(() => {});
  await sleep(1500);
  first = await connectPage(`chrome-extension://${EXT}/sidepanel/sidepanel.html`);
  panel = first.session;
}
report.boot = await panel.evaluate(await fromFile('expr-ui-boot.js'));

// 2. 正文页就位（截图与阅读此页要用）
const fixturePage = await connectPage('http://127.0.0.1:8899/fixture.html', { waits: [3500, 6000] });
const fixture = fixturePage.session;

report.views = await panel.evaluate(await fromFile('expr-ui-views.js'));

// 归一化：非视觉模型、关掉阅读此页、清空附件
report.normalize = await panel.evaluate(`(() => {
  els.model.value = 'deepseek-chat';
  els.model.dispatchEvent(new Event('change'));
  setReadPage(false);
  clearAttachments();
  els.input.value = '';
  return { model: state.model, readPage: state.readPage, attachments: state.attachments.length };
})()`);

// 3. 附加文件（文本）+ 截图（图片）
await panel.dom('DOM.enable');
const documentNode = await panel.dom('DOM.getDocument', { depth: 1 });
const picker = await panel.dom('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#filePicker' });
report.fileNode = picker.nodeId;
await panel.dom('DOM.setFileInputFiles', { files: [TEXT_FILE], nodeId: picker.nodeId });
await sleep(1500);
report.textFile = await panel.evaluate(await fromFile('expr-ui-shot.js'));

await fixture.send('Page.bringToFront');
await sleep(700);
await panel.evaluate('els.btnShot.click()');
await sleep(1500);
report.screenshot = await panel.evaluate(await fromFile('expr-ui-shot.js'));

// 4. 非视觉模型带图发送应被挡住，附件不丢
report.blockedClick = await panel.evaluate(await fromFile('expr-ui-send-image-blocked.js'));
await sleep(1200);
report.blocked = await panel.evaluate(await fromFile('expr-ui-state.js'));

// 5. 去掉图片，只留文本附件 -> 真实模型应能回答（验证附加文件全链路）
await panel.evaluate(`(() => {
  els.attachments.querySelector('.attach img').closest('.attach').querySelector('button').click();
  return state.attachments.map((a) => a.kind);
})()`);
await panel.evaluate('els.send.click()');
await sleep(16000);
report.withTextFile = await panel.evaluate(await fromFile('expr-ui-state.js'));

// 6. 视觉模型没有密钥：预扣 -> 上游未配置 -> 全额退回
await panel.evaluate('els.btnShot.click()');
await sleep(1200);
await panel.evaluate(`(() => {
  els.model.value = 'glm-4v-flash';
  els.model.dispatchEvent(new Event('change'));
  els.input.value = '图里有什么？';
  els.send.click();
  return 'sent';
})()`);
await sleep(7000);
report.visionNoKey = await panel.evaluate(await fromFile('expr-ui-state.js'));

// 7. 纯文字提问走真实模型
await panel.evaluate(`(() => {
  els.model.value = 'deepseek-chat';
  els.model.dispatchEvent(new Event('change'));
  setReadPage(false);
  clearAttachments();
  els.input.value = '用一句话说明 1+1 等于几。';
  els.send.click();
  return 'sent';
})()`);
await sleep(14000);
report.textChat = await panel.evaluate(await fromFile('expr-ui-state.js'));

// 8. 消息控件、重新生成、新聊天与历史
report.controls = await panel.evaluate(await fromFile('expr-ui-controls.js'));

await panel.evaluate(`(() => {
  const last = [...els.thread.querySelectorAll('.msg')].at(-1);
  const button = [...last.querySelectorAll('.msg-actions button')].find((b) => b.textContent === '重新生成');
  button?.click();
  return Boolean(button);
})()`);
await sleep(14000);
report.regenerated = await panel.evaluate(await fromFile('expr-ui-state.js'));

report.history = await panel.evaluate(await fromFile('expr-ui-history.js'));

// 9. 「阅读此页」走整页正文问答
await fixture.send('Page.bringToFront');
await sleep(600);
await panel.evaluate(`(() => {
  els.input.value = '这个页面讲的是什么事？';
  els.btnReadPage.click();
  els.send.click();
  return { readPage: state.readPage };
})()`);
await sleep(20000);
report.readPage = await panel.evaluate(await fromFile('expr-ui-state.js'));

await fs.writeFile('ui-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  device: { deviceId: report.boot.deviceId, token: report.boot.token },
  boot: report.boot,
  views: report.views,
  textFile: report.textFile,
  screenshot: report.screenshot,
  blocked: report.blocked,
  withTextFile: report.withTextFile,
  visionNoKey: report.visionNoKey,
  textChat: report.textChat,
  controls: report.controls,
  regenerated: report.regenerated,
  history: report.history,
  readPage: report.readPage,
}, null, 2));
panel.close();
fixture.close();
