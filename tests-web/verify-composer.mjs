// 校验 Composer 新排版：控件行在输入框上方、发送行在下方，新聊天/历史已搬进来且可用
// node verify-composer.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = process.env.CDP || 'http://127.0.0.1:9333';
const PANEL = `chrome-extension://${EXT}/sidepanel/sidepanel.html`;
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
  close() { this.ws.close(); }
}

const out = {};
const target = await (await fetch(`${DEBUG}/json/new?${PANEL}`, { method: 'PUT' })).json();
await sleep(5000);
const panel = new Session(target.webSocketDebuggerUrl);
await panel.open();
await panel.send('Runtime.enable');
await sleep(1500);

// reload 会销毁页面，等回复会挂死，只发不等
panel.send('Runtime.evaluate', { expression: 'location.reload(); "sent"', returnByValue: true });
await sleep(7000);

out.structure = await panel.evaluate(`(() => {
  const kids = [...document.querySelectorAll('#composer > *')].map((n) => n.id || n.className);
  return {
    composerChildren: kids,
    toolbarButtons: [...document.querySelectorAll('.toolbar button')].map((b) => b.id),
    controlsButtons: [...document.querySelectorAll('.composer-row.controls button')].map((b) => b.id),
    sendbarButtons: [...document.querySelectorAll('.composer-row.sendbar button')].map((b) => ({ id: b.id, hidden: b.hidden })),
  };
})()`);

out.geometry = await panel.evaluate(`(() => {
  const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; };
  const controls = box('.composer-row.controls'), input = box('#input'), send = box('.composer-row.sendbar');
  const model = box('#model'), shot = box('#btnShot'), file = box('#btnFile'), read = box('#btnReadPage'), chat = box('#newChat'), hist = box('#openHistory'), sendBtn = box('#send');
  return {
    顺序正确: controls.top < input.top && input.top < send.top,
    发送在输入框下方: sendBtn.top >= input.top + input.h - 2,
    控件行包含全部按钮: [model, shot, file, read, chat, hist].every((b) => b.top >= controls.top - 2 && b.top <= controls.top + controls.h + 2),
    历史靠右: Math.abs((hist.left + hist.w) - (controls.left + controls.w)) <= 2,
    新聊天与历史同行: Math.abs(chat.top - hist.top) <= 2,
    controls, input, send, model, shot, file, read, chat, hist, sendBtn,
  };
})()`);

out.overflow = await panel.evaluate(`(() => {
  const row = document.querySelector('.composer-row.controls');
  return { scrollW: row.scrollWidth, clientW: row.clientWidth, 溢出: row.scrollWidth > row.clientWidth + 1, panelW: innerWidth };
})()`);

// 历史按钮仍可用
out.history = await panel.evaluate(`(() => {
  document.querySelector('#openHistory').click();
  const dlg = document.querySelector('#historyDialog');
  return { open: dlg?.open === true, items: document.querySelectorAll('#historyDialog .history-list button').length };
})()`);
await sleep(800);
out.historyClosed = await panel.evaluate(`(() => { document.querySelector('#historyDialog')?.close?.(); return document.querySelector('#historyDialog')?.open === false; })()`);

// 新聊天按钮可用（不发消息，只验证会新建会话）
out.newChat = await panel.evaluate(`(async () => {
  const before = (await chrome.storage.local.get('sessions')).sessions?.length || 0;
  document.querySelector('#newChat').click();
  await new Promise((r) => setTimeout(r, 600));
  const after = (await chrome.storage.local.get('sessions')).sessions?.length || 0;
  return { before, after, title: document.querySelector('#viewTitle')?.textContent };
})()`);

await fs.writeFile('composer-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written composer-report.json');
panel.close();
process.exit(0);
