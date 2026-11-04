import fs from 'node:fs/promises';
const DEBUG = 'http://127.0.0.1:9333';
const targets = await (await fetch(`${DEBUG}/json`)).json();
const target = targets.find((t) => t.type === 'page' && t.url.includes('/sidepanel/sidepanel.html'));
const sock = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
sock.addEventListener('message', (e) => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
await new Promise((r) => sock.addEventListener('open', r, { once: true }));
const send = (method, params = {}) => { const n = ++id; sock.send(JSON.stringify({ id: n, method, params })); return new Promise((r) => pending.set(n, r)); };
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || 'eval error');
  return res.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: false });
await evaluate(`(() => {
  document.documentElement.dataset.theme = 'dark';
  document.getElementById('btnAdd').click();
  document.querySelector('[data-tab="plugin"]').click();
  document.querySelectorAll('#menuBody .menu-item')[0].click();
  return 'ok';
})()`);
await new Promise((r) => setTimeout(r, 400));
const res = await send('Page.captureScreenshot', { format: 'png' });
await fs.writeFile('caps-dark-narrow.png', Buffer.from(res.result.data, 'base64'));
console.log('saved');
await evaluate(`(() => {
  while (true) { const b = document.querySelector('#picks .pick button'); if (!b) break; b.click(); }
  document.getElementById('btnAdd').click();
  document.documentElement.dataset.theme = 'light';
  return 'ok';
})()`);
await send('Emulation.clearDeviceMetricsOverride');
sock.close();
