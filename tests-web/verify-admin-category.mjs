const PORT = 9333;
const ADMIN = 'http://127.0.0.1:5099';
const TARGET_URL = ADMIN + '/admin/models';
const KEY = 'sp-test-admin-key-2026';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTab(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.log('new tab failed:', text);
    process.exit(1);
  }
}

const target = await newTab('about:blank');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result.value;
};

await send('Page.enable');
await send('Page.navigate', { url: ADMIN + '/admin/' });
await sleep(1200);
await ev(`sessionStorage.setItem('sp_admin_key', ${JSON.stringify(KEY)}); sessionStorage.removeItem('sp_admin_token');`);
await send('Page.navigate', { url: TARGET_URL });
await sleep(2500);

const report = await ev(`(async () => {
  for (let i = 0; i < 30 && !document.querySelector('.ant-table'); i++) await new Promise(r => setTimeout(r, 200));
  const headers = [...document.querySelectorAll('.ant-table-thead th')].map(th => th.textContent.trim());
  const rows = [...document.querySelectorAll('.ant-table-tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()));
  return { href: location.href, title: document.querySelector('h3')?.textContent, headers, rows };
})()`);
console.log(JSON.stringify(report, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  const fs = await import('node:fs');
  fs.writeFileSync('tests-web/admin-category.png', Buffer.from(shot.data, 'base64'));
  console.log('saved tests-web/admin-category.png');
}

await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
ws.close();
process.exit(0);
