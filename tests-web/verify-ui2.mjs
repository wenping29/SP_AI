// 真机复验 v2：图片附件的非视觉拦截、去掉附件后的纯文本扣费、引用、重新生成、按钮回填
// node verify-ui2.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = process.env.CDP || 'http://127.0.0.1:9333';
const PANEL = `chrome-extension://${EXT}/sidepanel/sidepanel.html`;
const IMAGE_FILE = 'D:\\Project\\sp\\tests-web\\pixel.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) { this.pending.get(data.id)(data); this.pending.delete(data.id); }
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
    if (response.error) return { __cdp: response.error.message };
    const detail = response.result?.exceptionDetails;
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 260) };
    return response.result?.result?.value ?? null;
  }
  async dom(method, params) {
    const response = await this.send(method, params);
    if (response.error) throw new Error(`${method}: ${response.error.message}`);
    return response.result;
  }
  close() { this.ws.close(); }
}

const LEDGER = `(async () => {
  const { server, token } = await chrome.storage.local.get(['server', 'token']);
  const r = await fetch((server || 'http://127.0.0.1:5080') + '/api/credits', { headers: { Authorization: 'Bearer ' + token } });
  const j = await r.json();
  return { balance: j.balance, rows: (j.transactions || []).length, first: (j.transactions || [])[0] || null };
})()`;

const out = {};
const target = await (await fetch(`${DEBUG}/json/new?${PANEL}`, { method: 'PUT' })).json();
await sleep(5000);
const panel = new Session(target.webSocketDebuggerUrl);
await panel.open();
await panel.send('Runtime.enable');
await panel.send('DOM.enable');
await sleep(1500);

await panel.evaluate(`chrome.storage.local.set({ sessions: [], activeSession: null }).then(() => location.reload())`);
await sleep(7000);

out.boot = await panel.evaluate(`(() => ({ status: els.status.textContent.trim(), model: state.model, vision: !!currentModel()?.supportsVision }))()`);

// 1. 附加一张图片
const doc = await panel.dom('DOM.getDocument', {});
const picker = await panel.dom('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#filePicker' });
await panel.dom('DOM.setFileInputFiles', { files: [IMAGE_FILE], nodeId: picker.nodeId });
await sleep(2000);
out.attached = await panel.evaluate(`(() => ({
  kinds: state.attachments.map((a) => a.kind + ':' + a.name),
  chips: [...els.attachments.querySelectorAll('.attach .name')].map((n) => n.textContent),
  thumbs: els.attachments.querySelectorAll('img').length,
}))()`);

// 2. 非视觉模型 + 图片 → 拦住，且不发请求、不清附件
out.ledgerBeforeBlocked = await panel.evaluate(LEDGER);
await panel.evaluate(`els.input.value = '只用一句话回答：1+1 等于几'; els.send.click(); 'sent'`);
await sleep(3000);
out.blocked = await panel.evaluate(`({ status: els.status.textContent.trim(), busy: state.busy, attachments: state.attachments.length, msgs: document.querySelectorAll('#thread .msg').length })`);
out.ledgerAfterBlocked = await panel.evaluate(LEDGER);

// 3. 用 × 去掉图片附件
out.chipRemoved = await panel.evaluate(`(() => {
  const close = els.attachments.querySelector('.attach button, .attach .remove');
  const info = [...els.attachments.querySelectorAll('.attach *')].map((n) => n.className || n.tagName).join(',');
  close?.click();
  return { clicked: !!close, left: state.attachments.length, selectors: info };
})()`);

// 4. 纯文本发送 → 恰好一次扣分，且气泡按钮可用
out.ledgerBeforeText = await panel.evaluate(LEDGER);
await panel.evaluate(`els.input.value = '只用一句话回答：1+1 等于几'; els.send.click(); 'sent'`);
for (let i = 0; i < 25; i += 1) {
  await sleep(1000);
  const s = await panel.evaluate(`({ busy: state.busy, msgs: document.querySelectorAll('#thread .msg').length })`);
  if (s && !s.busy && s.msgs >= 2) { out.textDone = { sec: i + 1, ...s }; break; }
}
out.ledgerAfterText = await panel.evaluate(LEDGER);
out.bubbleButtons = await panel.evaluate(`(() => {
  const box = [...document.querySelectorAll('#thread .msg.assistant')].pop();
  return [...box.querySelectorAll('.msg-actions button')].map((b) => ({ label: b.textContent, disabled: b.disabled }));
})()`);

// 5. 引用
out.quote = await panel.evaluate(`(() => {
  const box = [...document.querySelectorAll('#thread .msg.assistant')].pop();
  const button = [...box.querySelectorAll('.msg-actions button')].find((b) => b.textContent === '引用');
  button.click();
  return { inputHead: els.input.value.slice(0, 40) };
})()`);

// 6. 重新生成 → 恰好再一次扣分
await panel.evaluate(`els.input.value = ''; 'cleared'`);
out.ledgerBeforeRegen = await panel.evaluate(LEDGER);
out.regenClick = await panel.evaluate(`(() => {
  const box = [...document.querySelectorAll('#thread .msg.assistant')].pop();
  const button = [...box.querySelectorAll('.msg-actions button')].find((b) => b.textContent === '重新生成');
  if (!button) return { found: false };
  button.click();
  return { found: true, disabled: button.disabled };
})()`);
for (let i = 0; i < 25; i += 1) {
  await sleep(1000);
  const s = await panel.evaluate(`({ busy: state.busy, msgs: document.querySelectorAll('#thread .msg').length })`);
  if (s && !s.busy && s.msgs === 2) { out.regenDone = { sec: i + 1, ...s }; break; }
}
out.ledgerAfterRegen = await panel.evaluate(LEDGER);
out.threadFinal = await panel.evaluate(`(() => [...document.querySelectorAll('#thread .msg')].map((n) => ({ role: n.className, text: (n.innerText || '').replace(/\\s+/g, ' ').slice(0, 120) })))()`);

await fs.writeFile('ui2-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written ui2-report.json');
panel.close();
process.exit(0);
