// 后台「服务器配置」页验证：渲染、运行信息、SMTP 表单保存、来源展示
import fs from 'node:fs/promises';

const DEBUG = 'http://127.0.0.1:9333';
const BASE = 'http://127.0.0.1:5099';
const ADMIN_KEY = 'cfg-test-key-2026';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      evaluate: async (expr) => {
        const r = await new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({
            id: mid, method: 'Runtime.evaluate',
            params: { expression: expr, awaitPromise: true, returnByValue: true },
          }));
        });
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
    ws.onerror = () => reject(new Error('ws error'));
  });
}

async function waitFor(s, expr, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await s.evaluate(expr).catch(() => null);
    if (value) return value;
    await sleep(300);
  }
  return null;
}

const report = { checks: [] };
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const target = await (await fetch(`${DEBUG}/json/new?about:blank`, { method: 'PUT' })).json();
const s = await connect(target);
await s.send('Page.enable');
await s.send('Runtime.enable');
await s.send('Page.navigate', { url: `${BASE}/admin/` });
await sleep(1500);
await s.evaluate(`(() => {
  sessionStorage.setItem('sp_admin_key', '${ADMIN_KEY}');
  sessionStorage.removeItem('sp_admin_token');
  return 'ok';
})()`);
await s.send('Page.navigate', { url: `${BASE}/admin/server` });
await sleep(2500);

const body = await waitFor(s, `document.body.innerText.includes('服务器配置') ? document.body.innerText : ''`);
check('页面标题渲染', !!body && body.includes('服务器配置'));
check('运行信息区块', !!body && body.includes('运行信息') && body.includes('密钥环目录'));
check('数据库路径可见', !!body && /tmp-server-cfg/.test(body));
check('邮件服务区块', !!body && body.includes('邮件服务（SMTP）'));
check('允许来源区块', !!body && body.includes('插件允许来源'));
const initialHost = await s.evaluate(`(() => {
  const item = [...document.querySelectorAll('.ant-form-item')]
    .find((el) => el.innerText.includes('SMTP 服务器'));
  return item?.querySelector('input')?.value ?? '';
})()`);
check('表单带出现有配置', /^smtp\.(example|qq)\.com$/.test(initialHost), initialHost);
check('来源标签为后台配置', !!body && body.includes('后台配置'));

// 修改 SMTP 服务器并保存
const filled = await s.evaluate(`(() => {
  const item = [...document.querySelectorAll('.ant-form-item')]
    .find((el) => el.innerText.includes('SMTP 服务器'));
  const input = item?.querySelector('input');
  if (!input) return 'no-input';
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'smtp.qq.com');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input.value;
})()`);
check('填入新的 SMTP 地址', filled === 'smtp.qq.com', String(filled));

const clicked = await s.evaluate(`(() => {
  const button = [...document.querySelectorAll('button')]
    .find((el) => el.innerText.includes('保存服务器配置'));
  if (!button) return 'no-button';
  if (button.disabled) return 'disabled';
  button.click();
  return 'clicked';
})()`);
check('点击保存', clicked === 'clicked', clicked);

const saved = await waitFor(s,
  `document.body.innerText.includes('服务器配置已保存') ? 'saved' : ''`, 10000);
check('保存成功提示', saved === 'saved');

const after = await (await fetch(`${BASE}/api/admin/server`, {
  headers: { 'X-Admin-Key': ADMIN_KEY },
})).json();
check('接口已保存新地址', after?.email?.host === 'smtp.qq.com', after?.email?.host);

const shot = await s.send('Page.captureScreenshot', { format: 'png' });
await fs.writeFile('server-config-report.json', JSON.stringify(report, null, 2));
await fs.writeFile('server-config.png', Buffer.from(shot.data, 'base64'));
if (report.checks.some((item) => !item.ok)) process.exitCode = 1;
s.close();
await fetch(`${DEBUG}/json/close/${target.id}`).catch(() => {});
console.log(`完成：${report.checks.filter((c) => c.ok).length}/${report.checks.length}`);
