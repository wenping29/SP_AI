const PORT = 9333;
const ADMIN = 'http://127.0.0.1:5099';
const KEY = 'sp-test-admin-key-2026';
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

await send('Page.enable');
await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
await send('Page.navigate', { url: ADMIN + '/admin/' });
await sleep(1200);
await ev(`sessionStorage.setItem('sp_admin_key', ${JSON.stringify(KEY)}); sessionStorage.removeItem('sp_admin_token');`);
await send('Page.navigate', { url: ADMIN + '/admin/models' });
await sleep(2500);
await ev(`(async () => { for (let i = 0; i < 30 && !document.querySelector('.ant-table-tbody tr'); i++) await new Promise(r => setTimeout(r, 200)); })()`);

const step = (name, value) => console.log('--- ' + name + '\n' + (typeof value === 'string' ? value : JSON.stringify(value, null, 2)));

// 1. 打开通义千问的编辑弹窗，读分类当前值
step('open editor', await ev(`(() => {
  const row = [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.textContent.includes('qwen-plus'));
  if (!row) return 'row not found';
  [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑').click();
  return 'clicked';
})()`));
await sleep(900);

const modal = await ev(`(() => {
  const items = [...document.querySelectorAll('.ant-modal .ant-form-item')];
  const item = items.find(i => i.querySelector('.ant-form-item-label')?.textContent.trim() === '分类');
  if (!item) return { error: 'category item not found', labels: items.map(i => i.querySelector('.ant-form-item-label')?.textContent.trim()) };
  const input = item.querySelector('input');
  return { value: input?.value, placeholder: input?.placeholder, modalOpen: !!document.querySelector('.ant-modal-wrap:not([style*="display: none"])') };
})()`);
step('modal category', modal);

// 2. 展开下拉，确认预设分类出现在候选里
await ev(`(() => {
  const items = [...document.querySelectorAll('.ant-modal .ant-form-item')];
  const item = items.find(i => i.querySelector('.ant-form-item-label')?.textContent.trim() === '分类');
  item?.querySelector('input')?.click();
  return 'clicked input';
})()`);
await sleep(600);
step('dropdown options', await ev(`[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].map(el => el.textContent.trim())`));

// 3. 改成自定义分类并保存
await ev(`(() => {
  const items = [...document.querySelectorAll('.ant-modal .ant-form-item')];
  const item = items.find(i => i.querySelector('.ant-form-item-label')?.textContent.trim() === '分类');
  const input = item.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '实验分组');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.value;
})()`);
await sleep(300);
await ev(`document.querySelector('.ant-modal-footer .ant-btn-primary').click()`);
await sleep(1500);
step('after save row', await ev(`(() => {
  const row = [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.textContent.includes('qwen-plus'));
  return row ? [...row.querySelectorAll('td')].map(td => td.textContent.trim()) : 'row gone';
})()`));

// 4. 改回“高级”
await ev(`(() => {
  const row = [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.textContent.includes('qwen-plus'));
  [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑').click();
  return 'clicked';
})()`);
await sleep(900);
await ev(`(() => {
  const items = [...document.querySelectorAll('.ant-modal .ant-form-item')];
  const item = items.find(i => i.querySelector('.ant-form-item-label')?.textContent.trim() === '分类');
  const input = item.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '高级');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.value;
})()`);
await sleep(300);
await ev(`document.querySelector('.ant-modal-footer .ant-btn-primary').click()`);
await sleep(1500);
step('restored row', await ev(`(() => {
  const row = [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.textContent.includes('qwen-plus'));
  return row ? [...row.querySelectorAll('td')].map(td => td.textContent.trim()) : 'row gone';
})()`));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  const fs = await import('node:fs');
  fs.writeFileSync('tests-web/admin-category-edit.png', Buffer.from(shot.data, 'base64'));
  console.log('saved tests-web/admin-category-edit.png');
}

await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
ws.close();
setTimeout(() => process.exit(0), 200);
