// 校验输入框的“添加技能/插件/计划/目标”菜单与语音按钮位置
// node verify-caps.mjs <extensionId>
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
await sleep(1200);

// reload 会销毁页面，等回复会挂死，只发不等
panel.send('Runtime.evaluate', { expression: 'location.reload(); "sent"', returnByValue: true });
await sleep(6000);

out.structure = await panel.evaluate(`(() => ({
  controls: [...document.querySelectorAll('.composer-row.controls button')].map((b) => b.id),
  sendbar: [...document.querySelectorAll('.composer-row.sendbar button')].map((b) => ({ id: b.id, hidden: b.hidden })),
  voiceInSendbar: !!document.querySelector('.composer-row.sendbar #btnVoice'),
  voiceInControls: !!document.querySelector('.composer-row.controls #btnVoice'),
  addIcon: !!document.querySelector('#btnAdd svg'),
  picks: !!document.getElementById('picks'),
  menu: !!document.getElementById('addMenu'),
}))()`);

out.geometry = await panel.evaluate(`(() => {
  const box = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left), w: Math.round(r.width) }; };
  const voice = box('#btnVoice'), send = box('#send'), bar = box('.composer-row.sendbar');
  return { voice, send, bar, gapToSend: send.left - voice.right, sameRow: Math.abs((voice.top + voice.bottom) / 2 - (send.top + send.bottom) / 2) < 4 };
})()`);

out.open = await panel.evaluate(`(() => {
  document.getElementById('btnAdd').click();
  const menu = document.getElementById('addMenu');
  const body = document.getElementById('menuBody');
  return {
    hidden: menu.hidden,
    expanded: document.getElementById('btnAdd').getAttribute('aria-expanded'),
    tabs: [...menu.querySelectorAll('[data-tab]')].map((t) => t.textContent),
    items: [...body.querySelectorAll('.menu-name')].map((n) => n.textContent),
    insideViewport: (() => { const r = menu.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })(),
  };
})()`);

out.skill = await panel.evaluate(`(() => {
  document.querySelector('#menuBody .menu-item').click();
  return {
    chips: [...document.querySelectorAll('#picks .pick-name')].map((n) => n.textContent),
    marked: document.querySelector('#menuBody .menu-item').classList.contains('on'),
    menuOpen: !document.getElementById('addMenu').hidden,
  };
})()`);

out.plugin = await panel.evaluate(`(() => {
  document.querySelector('[data-tab="plugin"]').click();
  const rows = [...document.querySelectorAll('#menuBody .menu-item')];
  rows[1].click();
  return {
    chips: [...document.querySelectorAll('#picks .pick-name')].map((n) => n.textContent),
    pluginMarked: document.querySelectorAll('#menuBody .menu-item')[1].classList.contains('on'),
    menuOpen: !document.getElementById('addMenu').hidden,
  };
})()`);

out.plan = await panel.evaluate(`(() => {
  document.querySelector('[data-tab="plan"]').click();
  document.querySelector('#menuBody .menu-item').click();
  return { chips: [...document.querySelectorAll('#picks .pick-name')].map((n) => n.textContent) };
})()`);

out.goal = await panel.evaluate(`(() => {
  document.querySelector('[data-tab="goal"]').click();
  const input = document.getElementById('goalInput');
  input.value = '验证用目标';
  document.getElementById('goalSave').click();
  return {
    menuOpen: !document.getElementById('addMenu').hidden,
    chips: [...document.querySelectorAll('#picks .pick-name')].map((n) => n.textContent),
    stored: (window.chrome && chrome.storage) ? 'n/a' : 'n/a',
  };
})()`);

out.outsideClose = await panel.evaluate(`(() => {
  document.getElementById('btnAdd').click();
  document.body.click();
  return { menuHidden: document.getElementById('addMenu').hidden };
})()`);

// 清掉验证过程添加的胶囊，避免留在会话里
out.cleanup = await panel.evaluate(`(() => {
  while (true) {
    const btn = document.querySelector('#picks .pick button');
    if (!btn) break;
    btn.click();
  }
  return { picksHidden: document.getElementById('picks').hidden, chips: document.querySelectorAll('#picks .pick').length };
})()`);

console.log(JSON.stringify(out, null, 2));
panel.close();
