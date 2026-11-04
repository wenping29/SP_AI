// 校验图标真的被扩展加载：清单、文件可取、面板里的 <img> 渲染尺寸
// node verify-icon.mjs <extensionId>
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
const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const out = {};

// 先开一个扩展页面用来触发真实重载（重载会销毁它，之后再重新打开）
const first = await (await fetch(`${DEBUG}/json/new?${PANEL}`, { method: 'PUT' })).json();
{
  const s = new Session(first.webSocketDebuggerUrl);
  await s.open().catch(() => null);
  await s.send('Runtime.enable').catch(() => null);
  await sleep(1500);
  // reload 会立刻销毁这个页面，等回复会挂死，所以只发不等
  s.send('Runtime.evaluate', { expression: 'chrome.runtime.reload(); "sent"' });
  await sleep(400);
  out.reload = 'sent';
  s.close();
}
await sleep(6000);

const target = await (await fetch(`${DEBUG}/json/new?${PANEL}`, { method: 'PUT' })).json();
await sleep(6000);
const panel = new Session(target.webSocketDebuggerUrl);
await panel.open();
await panel.send('Runtime.enable');
await sleep(1500);

out.manifest = await panel.evaluate(`(() => { const m = chrome.runtime.getManifest(); return { icons: m.icons, actionIcon: m.action && m.action.default_icon }; })()`);
out.fetchable = await panel.evaluate(`(async () => {
  const sizes = [16, 32, 48, 128];
  const rows = [];
  for (const s of sizes) {
    const r = await fetch(chrome.runtime.getURL('icons/icon' + s + '.png'));
    const b = await r.blob();
    rows.push({ size: s, status: r.status, bytes: b.size, type: b.type });
  }
  return rows;
})()`);
out.headerImg = await panel.evaluate(`(() => {
  const img = document.querySelector('.brand .brand-mark');
  return img ? { natural: [img.naturalWidth, img.naturalHeight], box: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)], complete: img.complete } : null;
})()`);
await panel.evaluate(`document.querySelector('#rail button[data-view="settings"]').click(); 'opened'`);
await sleep(1200);
out.settingsImg = await panel.evaluate(`(() => {
  const img = document.querySelector('.about img');
  return img ? { natural: [img.naturalWidth, img.naturalHeight], complete: img.complete, version: document.querySelector('#brandVersion')?.textContent } : null;
})()`);

await fs.writeFile('icon-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written icon-report.json');
panel.close();
process.exit(0);
