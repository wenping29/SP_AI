// 后台 UI：设备页只显示绑定用户，积分管理按用户调分并查看流水
import fs from "node:fs/promises";

const CDP = "http://127.0.0.1:9333";
const BASE = "http://127.0.0.1:5098";
const ADMIN_KEY = "sp-test-admin-key-2026";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { steps: [] };

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
          this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate timeout")), 10000)),
        ]);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error");
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
    ws.onerror = (err) => reject(new Error("ws error: " + (err?.message || err)));
  });
}

async function poll(s, expression, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await s.evaluate(expression)) return true;
    } catch { /* 页面跳转中 */ }
    await sleep(200);
  }
  return false;
}

const check = (name, okValue, detail = "") => {
  out.steps.push({ name, ok: !!okValue, detail });
  console.log(`${okValue ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

// 准备一个已登录设备与用户
const stamp = Date.now();
const email = `userui-${stamp}@example.com`;
const deviceId = `userui-${stamp}`;
const code = await (await fetch(`${BASE}/api/auth/email-code`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email }),
})).json();
await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "UserUi@2026", displayName: "界面积分用户", deviceId, label: "界面积分设备", code: code.devCode }),
});

const created = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`${BASE}/admin/login`)}`, { method: "PUT" })).json();
if (!created?.webSocketDebuggerUrl) {
  console.log("FAIL 无法打开新标签页");
  process.exit(1);
}
const s = await connect(created);
await s.send("Page.enable").catch(() => {});
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

await s.send("Page.navigate", { url: `${BASE}/admin/login` });
await poll(s, `document.readyState === "complete" && location.pathname.includes("/admin")`);
await sleep(300);
await s.evaluate(`sessionStorage.setItem('sp_admin_key', ${JSON.stringify(ADMIN_KEY)}); sessionStorage.removeItem('sp_admin_token'); 'ok'`);

const installHelpers = () => s.evaluate(`window.__row = (match) => [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.innerText.includes(match)) || null;
window.__clickInRow = (match, label) => {
  const row = window.__row(match);
  if (!row) throw new Error('row not found');
  const btn = [...row.querySelectorAll('button')].find(b => b.innerText.replace(/\\s+/g, '') === label);
  if (!btn) throw new Error('button not found: ' + label);
  btn.click(); return true;
}; 'ok'`);

// 设备页：只显示绑定用户，不再有积分入口
await s.send("Page.navigate", { url: `${BASE}/admin/devices` });
await poll(s, `document.body.innerText.includes("设备管理") && document.body.innerText.includes("绑定用户")`);
await installHelpers();
const deviceHeaders = await s.evaluate(`[...document.querySelectorAll('.ant-table-thead th')].map(th => th.innerText.trim())`);
check("设备页含绑定用户列", deviceHeaders.includes("绑定用户"), deviceHeaders.join(" / "));
check("设备页不再显示积分列",
  !deviceHeaders.includes("积分余额") && !deviceHeaders.includes("累计消耗") &&
  !deviceHeaders.includes("调用次数"),
  deviceHeaders.join(" / "));

const deviceRow = await s.evaluate(`window.__row(${JSON.stringify(deviceId)})?.innerText || ""`);
check("设备行显示绑定邮箱", deviceRow.includes(email), deviceRow.replace(/\s+/g, " "));
const deviceButtons = await s.evaluate(`[...(window.__row(${JSON.stringify(deviceId)})?.querySelectorAll('button') || [])].map(b => b.innerText.replace(/\\s+/g, ''))`);
check("设备行没有调分/流水入口",
  !deviceButtons.includes("调整积分") && !deviceButtons.includes("流水"),
  deviceButtons.join(" / "));

// 积分页：按用户列出，调分落到账号
await s.send("Page.navigate", { url: `${BASE}/admin/credits` });
await poll(s, `document.body.innerText.includes("积分管理") && document.body.innerText.includes(${JSON.stringify(email)})`);
await installHelpers();
const creditHeaders = await s.evaluate(`[...document.querySelectorAll('.ant-table-thead th')].map(th => th.innerText.trim())`);
check("积分页按用户展示余额与消耗",
  creditHeaders.includes("用户") && creditHeaders.includes("当前余额") &&
  creditHeaders.includes("累计消耗") && creditHeaders.includes("调用次数"),
  creditHeaders.join(" / "));

const creditRow = await s.evaluate(`window.__row(${JSON.stringify(email)})?.innerText || ""`);
check("积分行显示用户与余额 1000",
  creditRow.includes("界面积分用户") && creditRow.includes("1000"),
  creditRow.replace(/\s+/g, " "));

await s.evaluate(`window.__clickInRow(${JSON.stringify(email)}, '修改积分')`);
await poll(s, `document.querySelector('.ant-modal-content') !== null`);
const modalText = await s.evaluate(`document.querySelector('.ant-modal-content')?.innerText || ""`);
check("调分弹窗显示当前余额与邮箱",
  modalText.includes("当前余额 1000") && modalText.includes(email),
  modalText.replace(/\s+/g, " ").slice(0, 160));
check("调分弹窗说明多设备共享",
  modalText.includes("所有登录同一账号的设备同步生效"), "");

await s.evaluate(`[...document.querySelectorAll('.ant-modal-footer button')].find(b => b.innerText.replace(/\\s+/g, '') === '确认修改').click(); 'ok'`);
const adjusted = await poll(s, `window.__row(${JSON.stringify(email)})?.innerText.includes("1100")`);
await sleep(500);
const afterRow = await s.evaluate(`window.__row(${JSON.stringify(email)})?.innerText || ""`);
check("调分后余额更新为 1100", adjusted && afterRow.includes("1100"), afterRow.replace(/\s+/g, " "));

const memberRow = await (await fetch(`${BASE}/api/admin/members?q=${encodeURIComponent(email)}`, {
  headers: { "X-Admin-Key": ADMIN_KEY },
})).json();
check("服务端用户余额同步", memberRow.items?.[0]?.balance === 1100, String(memberRow.items?.[0]?.balance));

await s.evaluate(`window.__clickInRow(${JSON.stringify(email)}, '流水')`);
const flowShown = await poll(s, `(() => {
  const m = [...document.querySelectorAll('.ant-modal-content')].find(x => x.innerText.includes('积分流水'));
  return !!m && m.innerText.includes('后台调整') && m.innerText.includes('+100');
})()`, 12000);
const flowText = await s.evaluate(`([...document.querySelectorAll('.ant-modal-content')].find(x => x.innerText.includes('积分流水')) || {}).innerText || ''`);
check("流水弹窗显示后台调整记录", flowShown, flowText.replace(/\s+/g, " ").slice(0, 200));

s.close();
await fetch(`${CDP}/json/close/${created.id}`).catch(() => {});

out.allPassed = out.steps.every((x) => x.ok);
await fs.writeFile(new URL("./device-balance-ui-report.json", import.meta.url),
  JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ allPassed: out.allPassed }, null, 2));
process.exit(out.allPassed ? 0 : 1);
