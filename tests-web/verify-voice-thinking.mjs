// 真机复核：语音输入、终止思考，顺带把控件图标化的断言补齐
// node verify-voice-thinking.mjs <extensionId>
import fs from 'node:fs/promises';

const [,, EXT] = process.argv;
const DEBUG = 'http://127.0.0.1:9333';
const FIXTURE = 'http://127.0.0.1:8899/fixture.html';
const SERVER = 'http://127.0.0.1:5080';
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
      if (data.method === 'Runtime.consoleAPICalled') this.logs.push(`${data.params.type}: ${(data.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 200));
      if (data.method === 'Log.entryAdded') this.logs.push(`entry[${data.params.entry.level}]: ${data.params.entry.text}`.slice(0, 200));
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
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 240) };
    return response.result?.result?.value ?? null;
  }
  async wake() {
    await this.send('Page.enable').catch(() => null);
    await this.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => null);
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => null);
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (r?.result?.data) { await fs.writeFile(file, Buffer.from(r.result.data, 'base64')); return true; }
    return false;
  }
  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const panelTargets = async () => (await list()).filter((t) => /sidepanel\.html/.test(t.url));
const out = {};

async function connect(t) {
  const s = new Session(t.webSocketDebuggerUrl);
  await s.open().catch(() => null);
  await s.send('Runtime.enable').catch(() => null);
  await s.wake();
  await sleep(250);
  return s;
}

// 用扩展自己的 token 读余额：面板里 fetch 一次，避免在脚本里存令牌
async function creditsOf(panel) {
  return panel.evaluate(`(async () => {
    const r = await fetch(state.server + '/api/credits', { headers: { Authorization: 'Bearer ' + state.token } });
    const d = await r.json();
    return { balance: d.balance, top: d.transactions.slice(0, 3).map((t) => t.delta + ' ' + t.reason + ' ' + t.modelId) };
  })()`);
}

async function setupFixture() {
  const t0 = (await list()).find((t) => /fixture\.html/.test(t.url));
  const target = t0 || await (await fetch(`${DEBUG}/json/new?${FIXTURE}`, { method: 'PUT' })).json();
  const s = await connect(target);
  await s.send('Page.navigate', { url: FIXTURE });
  await sleep(3000);
  await s.send('Page.bringToFront').catch(() => null);
  await s.wake();
  await sleep(400);
  let world = null;
  for (const id of s.contexts.keys()) {
    if (await s.evaluate(`(typeof chrome!=='undefined'&&chrome.runtime&&chrome.runtime.id)||''`, id) === EXT) { world = id; break; }
  }
  return { session: s, worldId: world };
}

async function trustedClick(s, x, y) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, clickCount: 0 });
  await sleep(140);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(70);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
}

async function forceHover(s, selector) {
  await s.send('DOM.enable').catch(() => null);
  await s.send('CSS.enable').catch(() => null);
  const doc = await s.send('DOM.getDocument', { depth: -1 });
  const rootId = doc.result?.root?.nodeId;
  if (!rootId) return { error: 'no document root' };
  const q = await s.send('DOM.querySelector', { nodeId: rootId, selector });
  if (!q.result?.nodeId) return { error: 'not found: ' + selector, cdp: q.error?.message };
  await s.send('CSS.forcePseudoState', { nodeId: q.result.nodeId, forcedPseudoClasses: ['hover'] });
  await sleep(120);
  const style = await s.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const cs = getComputedStyle(el, '::after');
    return { content: cs.content, opacity: Number(cs.opacity), position: cs.position, writing: cs.writingMode }; })()`);
  await s.send('CSS.forcePseudoState', { nodeId: q.result.nodeId, forcedPseudoClasses: [] });
  return style;
}

// ---------- 1. 重载扩展，拿最新的 html/css/js ----------
const boot0 = await setupFixture();
boot0.session.evaluate(`chrome.runtime.sendMessage({type:'wake'}).catch(()=>{})`, boot0.worldId);
await sleep(2000);
const swT = (await list()).find((t) => t.type === 'service_worker');
if (!swT) { out.fatal = '没有服务端口'; await fs.writeFile('voice-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
{
  const s = await connect(swT);
  s.send('Runtime.evaluate', { expression: 'chrome.runtime.reload(); "sent"' });
  await sleep(300);
  s.close();
}
await sleep(9000);
boot0.session.close();

// ---------- 2. 重新导航 fixture，唤醒页面 ----------
const page = await setupFixture();
const fix = page.session;
const worldId = page.worldId;
out.worldId = worldId;
out.pageVis = await fix.evaluate(`document.visibilityState`, worldId);
await fix.evaluate(`chrome.storage.local.remove('pending')`, worldId);
out.savedPrefs = await fix.evaluate(`chrome.storage.local.get(['model','launcher']).then((v)=>v)`, worldId);

// ---------- 3. 召唤停靠面板 ----------
async function survey() {
  const rows = [];
  for (const t of await panelTargets()) {
    const s = await connect(t);
    rows.push({ id: t.id, ...(await s.evaluate(`({ innerW: innerWidth, mic: !!document.getElementById('btnVoice'), voice: state.config?.voice })`) || {}) });
    s.close();
  }
  return rows.find((r) => r.innerW < 600) || null;
}
let docked = await survey();
if (!docked) {
  const box = await fix.evaluate(`(() => { const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail')); const b=h?.shadowRoot?.querySelector('.rail button[data-tip="打开聊天"]'); const r=b?.getBoundingClientRect(); return r?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}:null; })()`, worldId);
  out.dockBox = box;
  if (box) { await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...box, buttons: 0, clickCount: 0 }); await trustedClick(fix, box.x, box.y); }
  for (let i = 0; i < 15; i += 1) { await sleep(1000); docked = await survey(); if (docked) break; }
}
out.docked = docked;
if (!docked?.id) { out.fatal = '没有面板实例'; await fs.writeFile('voice-report.json', JSON.stringify(out, null, 2), 'utf8'); process.exit(1); }
const panel = await connect((await panelTargets()).find((t) => t.id === docked.id));
await sleep(1200);

// ---------- 4. 控件图标化断言（含新增的麦克风） ----------
out.icons = await panel.evaluate(`(() => {
  const info = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { id: el.id || el.dataset.view || el.className, svg: !!el.querySelector('svg'), text: (el.textContent || '').trim(),
             tip: el.dataset.tip || null, nativeTitle: el.getAttribute('title'), aria: el.getAttribute('aria-label'),
             w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visible: r.width > 0 && cs.display !== 'none' }; };
  return {
    rail: [...document.querySelectorAll('#rail button')].map(info),
    controls: ['model','btnShot','btnFile','btnVoice','btnReadPage','newChat','openHistory'].map((id) => info(document.getElementById(id))),
    sendbar: ['send','stop'].map((id) => info(document.getElementById(id))),
    micHidden: document.getElementById('btnVoice').hidden,
    stopDisplayWhenHidden: getComputedStyle(document.getElementById('stop')).display,
  };
})()`);

out.toolsKeptNames = await panel.evaluate(`(() => {
  [...document.querySelectorAll('#rail button')].find((b)=>b.dataset.view==='tools').click();
  return { view: document.querySelector('#viewTitle').textContent,
           tools: [...document.querySelectorAll('#tools button')].map((b) => ({ svg: !!b.querySelector('svg'), name: b.querySelector('span')?.textContent, desc: b.querySelector('.tool-desc')?.textContent })) };
})()`);
await panel.evaluate(`[...document.querySelectorAll('#rail button')].find((b)=>b.dataset.view==='chat').click()`);
await sleep(500);

out.hoverBubbles = {
  navChat: await forceHover(panel, '#rail button[data-view="chat"]'),
  history: await forceHover(panel, '#openHistory'),
  send: await forceHover(panel, '#send'),
  voice: await forceHover(panel, '#btnVoice'),
};

// 悬浮栏气泡用真实鼠标移动（页面已唤醒）
const railFirst = await fix.evaluate(`(() => { const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail')); const b=h?.shadowRoot?.querySelector('.rail button'); const r=b?.getBoundingClientRect(); return r?{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}:null; })()`, worldId);
if (railFirst) {
  await fix.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...railFirst, buttons: 0, clickCount: 0 });
  await sleep(300);
  out.hoverLauncher = await fix.evaluate(`(() => {
    const h=[...document.documentElement.children].reverse().find((n)=>n.shadowRoot&&n.shadowRoot.querySelector('.rail'));
    const b=h.shadowRoot.querySelector('.rail button');
    const cs=getComputedStyle(b,'::after');
    return { content: cs.content, opacity: Number(cs.opacity), tip: b.dataset.tip, nativeTitle: b.getAttribute('title'), text: (b.textContent||'').trim(), svg: !!b.querySelector('svg') };
  })()`, worldId);
}

// ---------- 5. 麦克风权限与设备 ----------
out.micCapability = await panel.evaluate(`(async () => {
  const has = Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
  if (!has) return { supported: false };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const tracks = stream.getAudioTracks().map((t) => ({ label: t.label, state: t.state }));
    stream.getTracks().forEach((t) => t.stop());
    return { supported: true, granted: true, tracks, mime: ['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '' };
  } catch (err) {
    return { supported: true, granted: false, name: err.name, message: String(err.message || err) };
  }
})()`);

// ---------- 6. 上传转写：优先走真实录音，失败就用假音频验证上传链路 ----------
const beforeVoice = await creditsOf(panel);
out.voiceFlow = {};
if (out.micCapability?.granted) {
  const micBox = await panel.evaluate(`(() => { const r = document.getElementById('btnVoice').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
  await trustedClick(panel, micBox.x, micBox.y);
  await sleep(2200);
  out.voiceFlow.recording = await panel.evaluate(`(() => ({ pressed: document.getElementById('btnVoice').getAttribute('aria-pressed'), recording: document.getElementById('btnVoice').classList.contains('recording'), status: document.querySelector('#status').textContent, tip: document.getElementById('btnVoice').dataset.tip }))()`);
  await trustedClick(panel, micBox.x, micBox.y);
  await sleep(4500);
  out.voiceFlow.afterStop = await panel.evaluate(`(() => ({ status: document.querySelector('#status').textContent, value: document.getElementById('input').value, pressed: document.getElementById('btnVoice').getAttribute('aria-pressed') }))()`);
} else {
  out.voiceFlow.uploadOnly = await panel.evaluate(`(async () => {
    const blob = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
    await uploadVoice(blob);
    return { status: document.querySelector('#status').textContent, value: document.getElementById('input').value };
  })()`);
}
out.afterVoice = await creditsOf(panel);

// ---------- 7. 终止思考 ----------
await panel.evaluate(`(() => { state.model = 'deepseek-reasoner'; renderModels(); document.getElementById('input').value = '只回答一个字：猫是动物吗'; showView('chat'); })()`);
await sleep(300);
const beforeAbort = await creditsOf(panel);
await panel.evaluate(`send()`);
const abortTrace = [];
let aborted = false;
for (let i = 0; i < 45; i += 1) {
  await sleep(1000);
  const snap = await panel.evaluate(`(() => {
    const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1);
    const reasoning = box?.querySelector('.reasoning-body');
    return { status: document.querySelector('#status').textContent, streaming: Boolean(box?.classList.contains('streaming')),
             stopVisible: !document.getElementById('stop').hidden, stopTip: document.getElementById('stop').dataset.tip,
             reasoningChars: reasoning ? reasoning.textContent.length : 0, answer: box?.querySelector('.msg-body')?.textContent || '', busy: state.busy };
  })()`);
  abortTrace.push({ sec: i + 1, ...snap });
  if (snap.reasoningChars >= 40 && !aborted) {
    const stopBox = await panel.evaluate(`(() => { const b = document.getElementById('stop'); if (b.hidden) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    if (stopBox) await trustedClick(panel, stopBox.x, stopBox.y);
    else await panel.evaluate(`state.controller?.abort()`);
    aborted = true;
    await sleep(2200);
    out.abortPoint = { ...snap, stopBox };
    break;
  }
}
await sleep(1500);
out.afterAbort = await panel.evaluate(`(() => {
  const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1);
  return { status: document.querySelector('#status').textContent, stopTip: document.getElementById('stop').dataset.tip,
           body: box?.querySelector('.msg-body')?.textContent || null, summary: box?.querySelector('.reasoning summary')?.textContent || null,
           boxClass: box?.className || null, msgs: activeSession().messages.map((m) => m.role + ':' + clip(m.content, 20)),
           reasoningSaved: activeSession().messages.some((m) => m.role === 'assistant' && !m.content) };
})()`);
out.afterAbortCredits = await creditsOf(panel);
out.abortTrace = abortTrace;

// ---------- 8. 让它想完：思考过程折叠 + 正常扣分 ----------
await panel.evaluate(`document.getElementById('input').value = '只回答一个字：狗是动物吗'`);
await sleep(200);
const beforeDone = await creditsOf(panel);
await panel.evaluate(`send()`);
let doneSnap = null;
for (let i = 0; i < 90; i += 1) {
  await sleep(1000);
  const snap = await panel.evaluate(`(() => {
    const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1);
    return { busy: state.busy, status: document.querySelector('#status').textContent,
             summary: box?.querySelector('.reasoning summary')?.textContent || null,
             reasoningChars: box?.querySelector('.reasoning-body')?.textContent.length || 0,
             answer: box?.querySelector('.msg-body')?.textContent || '', open: box?.querySelector('.reasoning')?.open ?? null,
             actions: [...(box?.querySelectorAll('.msg-actions button') || [])].map((b) => ({ tip: b.dataset.tip, svg: !!b.querySelector('svg'), text: (b.textContent||'').trim() })),
             meta: box?.querySelector('.meta')?.textContent || null };
  })()`);
  if (!snap.busy && i > 2) { doneSnap = snap; break; }
}
out.completed = doneSnap;
out.completedCredits = await creditsOf(panel);
out.modelNow = await panel.evaluate(`state.model`);

// ---------- 9. 截图 + 收尾 ----------
out.shotPanel = await panel.shot('voice-panel.png');
out.shotPage = await fix.shot('voice-page.png');

out.cleaned = await panel.evaluate(`(async () => {
  const box = [...document.querySelectorAll('#thread .msg.assistant')].at(-1);
  const keep = box?.querySelector('.msg-body')?.textContent || '';
  return { lastAnswer: clip(keep, 40) };
})()`);
await panel.evaluate(`(() => { state.model = ${JSON.stringify(out.savedPrefs?.model || 'deepseek-chat')}; renderModels(); })()`).catch(() => null);
await fix.evaluate(`chrome.storage.local.remove('pending')`, worldId).catch(() => null);
out.restoredPrefs = await fix.evaluate(`chrome.storage.local.get(['model','launcher']).then((v)=>v)`, worldId);

await fs.writeFile('voice-report.json', JSON.stringify(out, null, 2), 'utf8');
console.log('written voice-report.json');
panel.close();
fix.close();
process.exit(0);
