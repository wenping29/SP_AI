const PORT = 9333;
const ADMIN = 'http://127.0.0.1:5099';
const KEY = 'sp-test-admin-key-2026';
const DEVICE = 'device-test-0001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
await fetch(`http://127.0.0.1:${PORT}/json/activate/${target.id}`);
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
const step = (name, value) => console.log('--- ' + name + '\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 2)));

await send('Page.enable');
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
await send('Page.navigate', { url: ADMIN + '/admin/' });
await sleep(1200);
await ev(`sessionStorage.setItem('sp_admin_key', ${JSON.stringify(KEY)}); sessionStorage.removeItem('sp_admin_token');`);
await send('Page.navigate', { url: ADMIN + '/admin/credits' });
await sleep(2500);
await ev(`(async () => { for (let i = 0; i < 30 && !document.querySelector('.ant-table-tbody tr'); i++) await new Promise(r => setTimeout(r, 200)); })()`);

step('page', await ev(`(() => ({
  href: location.href,
  title: document.querySelector('h3')?.textContent,
  menu: [...document.querySelectorAll('.ant-menu-item')].map(el => el.textContent.trim()),
  stats: [...document.querySelectorAll('.ant-statistic')].map(el => el.textContent.trim()),
  headers: [...document.querySelectorAll('.ant-table-thead th')].map(th => th.textContent.trim()),
  rows: [...document.querySelectorAll('.ant-table-tbody tr')].slice(0, 3).map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim())),
}))()`));

const rowBalance = () => ev(`(() => {
  const row = [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.textContent.includes('${DEVICE}'));
  return row ? [...row.querySelectorAll('td')].map(td => td.textContent.trim()) : 'row missing';
})()`);
const summaryText = () => ev(`[...document.querySelectorAll('.ant-statistic')].map(el => el.textContent.trim())`);

const openAdjust = () => ev(`(() => {
  const row = [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.textContent.includes('${DEVICE}'));
  if (!row) return 'row missing';
  [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '修改积分').click();
  return 'opened';
})()`);
const setMode = (label) => ev(`(() => {
  const radio = [...document.querySelectorAll('.ant-modal .ant-radio-button-wrapper')].find(el => el.textContent.trim() === ${JSON.stringify(label)});
  if (!radio) return 'radio missing';
  radio.click();
  return 'mode ' + ${JSON.stringify(label)};
})()`);
const setAmount = (value) => ev(`(() => {
  const input = document.querySelector('.ant-modal .ant-input-number-input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, String(${value}));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  return input.value;
})()`);
const save = async () => {
  await ev(`document.querySelector('.ant-modal-footer .ant-btn-primary').click()`);
  await sleep(1500);
};

step('row before', await rowBalance());
step('summary before', await summaryText());

// 1. 直接设为 1200
step('open 1', await openAdjust());
await sleep(500);
step('modal', await ev(`(() => {
  const content = document.querySelector('.ant-modal-content');
  return {
    title: content?.querySelector('.ant-modal-title')?.textContent,
    tags: [...content.querySelectorAll('.ant-tag')].map(t => t.textContent.trim()),
    modes: [...content.querySelectorAll('.ant-radio-button-wrapper')].map(el => el.textContent.trim()),
    amount: content?.querySelector('.ant-input-number-input')?.value,
    preview: content?.textContent.includes('调整后余额'),
  };
})()`));
step('mode set', await setMode('设为指定余额'));
await sleep(300);
step('amount 1200', await setAmount(1200));
await sleep(300);
step('preview', await ev(`(async () => {
  await new Promise(r => setTimeout(r, 400));
  const text = document.querySelector('.ant-modal-content')?.textContent || '';
  const m = text.match(/调整后余额[：:]\\s*(-?\\d+)/);
  return m ? m[1] : 'no preview';
})()`));
await save();
step('row after set', await rowBalance());
step('summary after set', await summaryText());

// 2. 扣减 200
step('open 2', await openAdjust());
await sleep(500);
step('mode deduct', await setMode('扣减'));
await sleep(300);
await setAmount(200);
await save();
step('row after deduct', await rowBalance());

// 3. 恢复为 956
step('open 3', await openAdjust());
await sleep(500);
await setMode('设为指定余额');
await sleep(300);
await setAmount(956);
await save();
step('row restored', await rowBalance());
step('summary restored', await summaryText());

// 4. 超余额扣减在页面上被表单拦截
step('open 4', await openAdjust());
await sleep(500);
await setMode('扣减');
await sleep(300);
await setAmount(999999);
await save();
step('validation error', await ev(`[...document.querySelectorAll('.ant-form-item-explain-error')].map(el => el.textContent.trim())`));
await ev(`(() => { const btn = [...document.querySelectorAll('.ant-modal-footer button')].find(b => b.textContent.trim() === '取消'); btn?.click(); return 'closed'; })()`);
await sleep(600);

// 5. 流水弹窗
step('open ledger', await ev(`(() => {
  const row = [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.textContent.includes('${DEVICE}'));
  [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '流水').click();
  return 'opened';
})()`));
await sleep(1200);
step('ledger', await ev(`(() => {
  const modals = [...document.querySelectorAll('.ant-modal-content')];
  const m = modals[modals.length - 1];
  return {
    title: m?.querySelector('.ant-modal-title')?.textContent,
    tags: [...(m?.querySelectorAll('.ant-tag') || [])].slice(0, 3).map(t => t.textContent.trim()),
    firstRows: [...(m?.querySelectorAll('.ant-table-tbody tr') || [])].slice(0, 4).map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim())),
  };
})()`));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  const fs = await import('node:fs');
  fs.writeFileSync('tests-web/admin-credits.png', Buffer.from(shot.data, 'base64'));
  console.log('saved tests-web/admin-credits.png');
}

await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
ws.close();
setTimeout(() => process.exit(0), 200);
