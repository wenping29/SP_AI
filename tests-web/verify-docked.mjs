// 真机验证：划词手势 -> 停靠侧边栏 -> 单次扣分，并在停靠面板里跑剩下的 Composer 控件
// node verify-docked.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
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
      if (data.id && this.pending.has(data.id)) {
        this.pending.get(data.id)(data);
        this.pending.delete(data.id);
      }
      if (data.method === 'Runtime.executionContextCreated') {
        this.contexts.set(data.params.context.id, data.params.context);
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
    const response = await this.send('Runtime.evaluate', {
      expression: typeof expression === 'string' ? expression : String(expression),
      returnByValue: true,
      awaitPromise: true,
      contextId,
    });
    if (response.error) return { __cdp: response.error.message.slice(0, 160) };
    const detail = response.result?.exceptionDetails;
    if (detail) return { __error: (detail.exception?.description || detail.text || '执行出错').slice(0, 240) };
    return response.result?.result?.value ?? null;
  }

  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const closeAll = async (pattern) => {
  for (const t of await list()) if (pattern.test(t.url)) await fetch(`${DEBUG}/json/close/${t.id}`).catch(() => {});
};
const fromFile = async (name) => fs.readFile(name, 'utf8');
const panelState = await fromFile('expr-ui-state.js');
const report = {};

// 1. 清掉残留的面板标签页实例，保证划词广播只有一个面板会执行
await closeAll(/sidepanel\.html|fixture\.html/);
await sleep(1500);

// 2. 打开正文页，找到内容脚本隔离世界
const fixtureTarget = await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json();
await sleep(4000);
const fixture = new Session(fixtureTarget.webSocketDebuggerUrl);
await fixture.open();
await fixture.send('Page.enable');
await fixture.send('Page.bringToFront');
await fixture.send('Runtime.enable');
await sleep(800);

let worldId = null;
for (const id of fixture.contexts.keys()) {
  const value = await fixture.evaluate(`(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || ''`, id);
  if (value === EXT) { worldId = id; break; }
}
report.worldId = worldId;
if (worldId === null) {
  console.log(JSON.stringify({ ...report, reason: '正文页没有该扩展的隔离世界' }, null, 2));
  process.exit(3);
}

// 3. 先记下当前流水，再用真实鼠标点浮层「翻译」——手势必须一路活到 sidePanel.open
const panelBefore = await list();
const toolbar = await fixture.evaluate(await fromFile('expr-toolbar.js'), worldId);
report.toolbar = toolbar;
const button = (toolbar.buttons || []).find((item) => item.label === '翻译');
if (button) {
  const point = { x: button.x, y: button.y, buttons: 'left', clickCount: 1 };
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
}
await sleep(4500);

// 4. 停靠面板应出现且只有一个实例
const opened = (await list()).filter((t) => !panelBefore.some((old) => old.id === t.id) && /sidepanel/.test(t.url));
report.dockedTargets = opened.map((t) => ({ id: t.id.slice(0, 8), type: t.type, url: t.url.slice(0, 70) }));
if (!opened.length) {
  console.log(JSON.stringify({ ...report, reason: '手势没有打开停靠面板' }, null, 2));
  process.exit(4);
}

const docked = new Session(opened[0].webSocketDebuggerUrl);
await docked.open();
await sleep(12000);
report.afterHandoff = await docked.evaluate(panelState);

const creditsExpr = `fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } })
  .then((r) => r.json())
  .then((d) => ({ balance: d.balance, chat: d.transactions.filter((t) => t.reason === 'chat').length,
    latest: d.transactions.slice(0, 4).map((t) => t.at + ' ' + t.delta + ' ' + t.reason + ' ' + t.inputTokens + '/' + t.outputTokens) }))`;
report.creditsAfterHandoff = await docked.evaluate(creditsExpr);

// 5. 停靠面板里框选截图：点按钮后在网页里拖出一块区域，面板应插入裁剪后的图片
await fixture.send('Page.bringToFront');
await sleep(600);
await docked.evaluate('els.btnShot.click()');
await sleep(900);
const drag = (type, x, y, buttons) => fixture.send('Input.dispatchMouseEvent', {
  type, x, y, button: 'left', buttons, clickCount: 1,
});
await drag('mouseMoved', 60, 80, 0);
await drag('mousePressed', 60, 80, 1);
await drag('mouseMoved', 360, 260, 1);
await drag('mouseReleased', 360, 260, 0);
await sleep(1800);
// 裁剪完成后先完成标绘确认，才会计入附件
await docked.evaluate('els.annotateConfirm.click()');
await sleep(800);
report.shotInDock = await docked.evaluate(await fromFile('expr-ui-shot.js'));

// 6. 非视觉模型 + 图片 -> 拦截，且附件不丢
await docked.evaluate(`(() => {
  els.model.value = 'deepseek-chat';
  els.model.dispatchEvent(new Event('change'));
  els.input.value = '图里有什么？';
  els.send.click();
  return state.attachments.map((a) => a.kind);
})()`);
await sleep(1500);
report.blockedGuard = await docked.evaluate(`(() => ({
  status: els.status.textContent,
  attachments: state.attachments.map((a) => a.kind),
  chips: els.attachments.querySelectorAll('.attach').length,
  inputKept: els.input.value,
  balance: els.balance.textContent,
}))()`);

// 7. 去掉图片，改成纯文字提问走真实模型；随后测引用与重新生成的扣分
await docked.evaluate(`(() => {
  const img = els.attachments.querySelector('.attach img');
  if (img) img.closest('.attach').querySelector('button').click();
  els.input.value = '用一句话说明 2+2 等于几。';
  els.send.click();
  return 'sent';
})()`);
await sleep(14000);
report.textAfterShot = await docked.evaluate(panelState);

report.copyQuote = await docked.evaluate(`(() => {
  const last = [...els.thread.querySelectorAll('.msg')].at(-1);
  const buttons = [...last.querySelectorAll('.msg-actions button')];
  const labels = buttons.map((b) => b.textContent);
  buttons.find((b) => b.textContent === '复制')?.click();
  const afterCopy = els.status.textContent;
  return { labels, afterCopy };
})()`);
await sleep(600);
report.copyQuote.status = await docked.evaluate('els.status.textContent');

report.quoted = await docked.evaluate(`(() => {
  const last = [...els.thread.querySelectorAll('.msg')].at(-1);
  [...last.querySelectorAll('.msg-actions button')].find((b) => b.textContent === '引用')?.click();
  return { value: els.input.value.slice(0, 50), length: els.input.value.length, view: state.view };
})()`);
await docked.evaluate('els.input.value = ""');

report.regenBefore = await docked.evaluate(creditsExpr);
report.regenClicked = await docked.evaluate(`(() => {
  const last = [...els.thread.querySelectorAll('.msg')].at(-1);
  const button = [...last.querySelectorAll('.msg-actions button')].find((b) => b.textContent === '重新生成');
  if (!button) return '没有重新生成按钮';
  button.click();
  return 'clicked';
})()`);
await sleep(14000);
report.regenAfter = await docked.evaluate(creditsExpr);
report.regenState = await docked.evaluate(panelState);

await fs.writeFile('docked-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
docked.close();
fixture.close();
