// 只判断两件事：点击有没有写入 pending、pending 写入后停靠面板有没有出现（200ms 采样）
// node probe-gesture.mjs <extensionId>
import fs from 'node:fs/promises';

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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 260) };
    return response.result?.result?.value ?? null;
  }
  close() { this.ws.close(); }
}
const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const out = { samples: [] };

for (const t of await list()) {
  if (/sidepanel\.html/.test(t.url)) await fetch(`${DEBUG}/json/close/${t.id}`).catch(() => {});
}
await sleep(1000);

const fxTarget = (await list()).find((t) => /fixture\.html/.test(t.url));
const fixture = new Session(fxTarget.webSocketDebuggerUrl);
await fixture.open();
await fixture.send('Page.enable');
await fixture.send('Page.navigate', { url: FIXTURE });
await sleep(4000);
await fixture.send('Page.bringToFront');
await fixture.send('Runtime.enable');
await sleep(600);

let worldId = null;
for (const id of fixture.contexts.keys()) {
  if (await fixture.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { worldId = id; break; }
}
out.worldId = worldId;
await fixture.evaluate(`chrome.storage.local.remove('pending')`, worldId);
const toolbar = await fixture.evaluate(await fs.readFile('expr-toolbar.js', 'utf8'), worldId);
const button = (toolbar.buttons || []).find((item) => item.label === '翻译');
out.toolbar = { barDisplay: toolbar.barDisplay, box: toolbar.barPosition, sel: toolbar.selectionText };
out.button = button || null;
out.focusBefore = await fixture.evaluate(`document.hasFocus()`, worldId);
// 在内容脚本世界里挂钩 sendMessage，直接看点击有没有真的发消息（不靠扣费反推）
await fixture.evaluate(`(() => {
  window.__sendLog = [];
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...rest) => { window.__sendLog.push({ type: m && m.type, actionId: m && m.actionId, selLen: (m && m.selection || '').length, ts: Date.now() }); return orig(m, ...rest).then((r) => { window.__sendLog.push({ ok: true, reply: r && r.ok, err: r && r.error }); return r; }, (e) => { window.__sendLog.push({ rejected: String(e.message) }); }); };
  return 'patched';
})()`, worldId);
out.hit = await fixture.evaluate(`(() => { const el = document.elementFromPoint(${button?.x || 0}, ${button?.y || 0}); const host = [...document.documentElement.children].reverse().find((n) => n.tagName === 'DIV' && n.shadowRoot); return { tag: el?.tagName, isHost: el === host, selLen: String(getSelection()).length }; })()`, worldId);

if (button) {
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: button.x, y: button.y, buttons: 0, clickCount: 0 });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: button.x, y: button.y, button: 'left', buttons: 1, clickCount: 1 });
  await fixture.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: button.x, y: button.y, button: 'left', buttons: 0, clickCount: 1 });
}
for (let i = 0; i < 40; i += 1) {
  await sleep(200);
  const pending = await fixture.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending?v.pending.actionId:null)`, worldId);
  const panels = (await list()).filter((t) => /sidepanel/.test(t.url)).length;
  out.samples.push({ ms: (i + 1) * 200, pending, panels });
  if (pending === null && i > 2 && out.samples.some((s) => s.pending === 'translate')) break;
}
out.panelsFinal = (await list()).filter((t) => /sidepanel/.test(t.url)).map((t) => t.type + ':' + t.url.slice(0, 50));
out.windows = await fixture.evaluate(`chrome.runtime.getPlatformInfo ? 'ok' : 'no'`, worldId);

// 对照组：同一个上下文里直接投递，验证消息通道本身是否可用
out.manifest = await fixture.evaluate(`(() => { try { return chrome.runtime.getManifest().version; } catch (e) { return 'threw: ' + e.message; } })()`, worldId);
out.control = await fixture.evaluate(`chrome.runtime.sendMessage({ type: 'sp-action', actionId: 'explain', selection: '对照组探针' }).then(() => 'ok').catch((e) => '失败: ' + e.message)`, worldId);
await sleep(1500);
out.controlPending = await fixture.evaluate(`chrome.storage.local.get('pending').then((v)=>v.pending?v.pending.actionId:null)`, worldId);
out.sendLog = await fixture.evaluate(`window.__sendLog || null`, worldId);
await fixture.evaluate(`chrome.storage.local.remove('pending')`, worldId);
out.pendingCleared = true;

await fs.writeFile('probe-gesture.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written probe-gesture.json, samples:', out.samples.length);
fixture.close();
process.exit(0);
