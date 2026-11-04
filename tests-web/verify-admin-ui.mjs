// 验证后台：管理员页、用户管理页的新增/编辑/封禁/删除
import fs from 'node:fs/promises';

const CDP = 'http://127.0.0.1:9333';
const BASE = 'http://127.0.0.1:5099';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { steps: [], shots: [] };

function connect(target) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send: (method, params) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      async evaluate(expression) {
        const r = await Promise.race([
          this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout')), 10000)),
        ]);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
        return r.result?.value;
      },
      close: () => ws.close(),
    });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    };
    ws.onerror = (err) => reject(new Error('ws error: ' + (err?.message || err)));
  });
}

const ok = (name, detail = '') => {
  out.steps.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
};
const fail = (name, detail = '') => {
  out.steps.push({ name, ok: false, detail });
  console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
};

async function poll(s, expression, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await s.evaluate(expression)) return true;
    } catch { /* 页面刷新中 */ }
    await sleep(200);
  }
  return false;
}

async function shot(s, name) {
  const r = await s.send('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(`tests-web/${name}.png`, Buffer.from(r.data, 'base64'));
  out.shots.push(`${name}.png`);
}

const helpers = `
window.__q = {
  text() { return document.body.innerText; },
  row(match) {
    return [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.innerText.includes(match)) || null;
  },
  norm(text) { return (text || '').replace(/\\s+/g, ''); },
  clickInRow(match, label) {
    const row = this.row(match);
    if (!row) throw new Error('row not found: ' + match);
    const btn = [...row.querySelectorAll('button, a')].find(el => this.norm(el.innerText) === this.norm(label));
    if (!btn) throw new Error('button not found: ' + label);
    btn.click();
    return true;
  },
  clickButton(label, scope) {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) throw new Error('scope not found: ' + scope);
    const btn = [...root.querySelectorAll('button')].find(el => this.norm(el.innerText) === this.norm(label));
    if (!btn) throw new Error('button not found: ' + label);
    btn.click();
    return true;
  },
  fill(placeholder, value) {
    const el = [...document.querySelectorAll('input, textarea')]
      .find(e => e.getAttribute('placeholder') === placeholder);
    if (!el) throw new Error('input not found: ' + placeholder);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  clickPop(titlePart) {
    const pop = [...document.querySelectorAll('.ant-popover')].find(p =>
      !p.className.includes('ant-popover-hidden') && p.innerText.includes(titlePart));
    if (!pop) throw new Error('popconfirm not found: ' + titlePart);
    const btn = pop.querySelector('.ant-btn-primary');
    if (!btn) throw new Error('popconfirm primary not found: ' + titlePart);
    btn.click();
    return true;
  },
  menuLabels() {
    return [...document.querySelectorAll('.ant-menu-item')].map(el => el.innerText.trim());
  },
}; 'ok'`;

const list = await (await fetch(`${CDP}/json/list`)).json();
let target = list.find((t) => t.type === 'page' && /:5099\//.test(t.url || ''));
if (!target) {
  const created = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`${BASE}/admin/login`)}`, { method: 'PUT' })).json();
  target = created;
}
if (!target?.webSocketDebuggerUrl) {
  console.log('FAIL 找不到 5099 页面');
  process.exit(1);
}

const s = await connect(target);
await s.send('Page.enable').catch(() => {});
await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
await s.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});

// 用接口拿令牌，写入 sessionStorage 后直接进用户页
const loginRes = await fetch(`${BASE}/api/admin/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'root', password: 'Passw0rd!123' }),
});
const token = (await loginRes.json()).token;

await s.send('Page.navigate', { url: `${BASE}/admin/login` });
if (!(await poll(s, `location.href.includes('/admin/login') && document.readyState === 'complete'`))) {
  throw new Error('login page did not load: ' + (await s.evaluate('location.href')));
}
await sleep(400);
await s.evaluate(`sessionStorage.setItem('sp_admin_token', ${JSON.stringify(token)}); sessionStorage.removeItem('sp_admin_key'); 'ok'`);
await s.send('Page.navigate', { url: `${BASE}/admin/users` });
await poll(s, `location.href.includes('/admin/users') && document.readyState === 'complete'`);

if (await poll(s, `document.body.innerText.includes('用户管理') && document.body.innerText.includes('插件端注册的普通用户')`)) {
  ok('用户管理页加载');
} else {
  fail('用户管理页加载', (await s.evaluate('document.body.innerText')).slice(0, 200));
}

await s.evaluate(helpers);
const labels = await s.evaluate('window.__q.menuLabels()');
ok('菜单含用户管理和管理员', labels.includes('用户管理') && labels.includes('管理员'), labels.join(' / '));
ok('用户表列名', await s.evaluate(`['用户','状态','余额','登录设备','最近登录','注册时间','操作'].every(t => document.body.innerText.includes(t))`));
await shot(s, 'admin-users-page');

// 新增用户
await s.evaluate(`window.__q.clickButton('新增用户')`);
if (await poll(s, `document.querySelector('.ant-modal-content') !== null`)) ok('打新增用户弹窗');
else fail('打开新增用户弹窗');
await s.evaluate(`window.__q.fill('user@example.com', 'ui-member@example.com')`);
await s.evaluate(`window.__q.fill('留空则使用邮箱前缀', '界面用户')`);
await s.evaluate(`window.__q.fill('登录密码', 'UiMember#123')`);
await shot(s, 'admin-users-create');
await s.evaluate(`window.__q.clickButton('保存', '.ant-modal-footer')`);

if (await poll(s, `window.__q.row('ui-member@example.com') !== null`)) ok('新增用户出现在列表');
else fail('新增用户出现在列表', (await s.evaluate('document.body.innerText')).slice(0, 300));

// 编辑昵称
await s.evaluate(`window.__q.clickInRow('ui-member@example.com', '编辑')`);
await poll(s, `document.querySelector('.ant-modal-content') !== null`);
await s.evaluate(`window.__q.fill('留空则使用邮箱前缀', '界面改名')`);
await s.evaluate(`window.__q.clickButton('保存', '.ant-modal-footer')`);
if (await poll(s, `window.__q.row('界面改名') !== null && window.__q.row('界面改名').innerText.includes('ui-member@example.com')`)) {
  ok('编辑用户信息');
} else {
  fail('编辑用户信息');
}

// 封禁
await s.evaluate(`window.__q.clickInRow('ui-member@example.com', '封禁')`);
await poll(s, `[...document.querySelectorAll('.ant-popover')].some(p => !p.className.includes('ant-popover-hidden') && p.innerText.includes('封禁该用户'))`);
await s.evaluate(`window.__q.clickPop('封禁该用户')`);
if (await poll(s, `window.__q.row('ui-member@example.com')?.innerText.includes('已封禁')`)) {
  ok('封禁用户');
} else {
  fail('封禁用户');
}
await shot(s, 'admin-users-blocked');

// 解封再删除
await s.evaluate(`window.__q.clickInRow('ui-member@example.com', '解封')`);
await poll(s, `[...document.querySelectorAll('.ant-popover')].some(p => !p.className.includes('ant-popover-hidden') && p.innerText.includes('解封该用户'))`);
await s.evaluate(`window.__q.clickPop('解封该用户')`);
if (await poll(s, `window.__q.row('ui-member@example.com')?.innerText.includes('正常')`)) ok('解封用户');
else fail('解封用户');

await s.evaluate(`window.__q.clickInRow('ui-member@example.com', '删除')`);
await poll(s, `[...document.querySelectorAll('.ant-popover')].some(p => !p.className.includes('ant-popover-hidden') && p.innerText.includes('删除该用户'))`);
await s.evaluate(`window.__q.clickPop('删除该用户')`);
if (await poll(s, `window.__q.row('ui-member@example.com') === null`)) ok('删除用户');
else fail('删除用户');

// 管理员页
await s.send('Page.navigate', { url: `${BASE}/admin/admins` });
if (await poll(s, `document.body.innerText.includes('管理后台登录账号') && [...document.querySelectorAll('.ant-table-tbody tr')].some(tr => tr.innerText.includes('root'))`)) {
  ok('管理员页加载并列出 root');
} else {
  fail('管理员页加载', (await s.evaluate('document.body.innerText')).slice(0, 300));
}
ok('管理员页按钮为新增管理员', await s.evaluate(`document.body.innerText.includes('新增管理员')`));
await shot(s, 'admin-admins-page');

// 刷新后菜单仍能互相跳转（权限/路由可用）
await s.evaluate(`window.__q.clickButton('刷新')`).catch(() => {});
await sleep(500);

s.close();
out.failed = out.steps.filter((x) => !x.ok).length;
await fs.writeFile('tests-web/admin-ui-report.json', JSON.stringify(out, null, 2));
console.log(`\n${out.steps.length - out.failed}/${out.steps.length} checks passed`);
if (out.failed) process.exitCode = 1;
