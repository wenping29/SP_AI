// 设备管理 UI：显示账号余额、调分按钮与调分结果
import fs from "node:fs/promises";

const CDP = "http://127.0.0.1:9333";
const BASE = "http://127.0.0.1:5098";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = JSON.parse(await fs.readFile(new URL("../server/appsettings.json", import.meta.url), "utf8"));
const ADMIN_KEY = cfg.Admin.Key;
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

// 准备一个已登录设备
const email = `devui-${Date.now()}@example.com`;
const deviceId = `devui-${Date.now()}`;
const code = await (await fetch(`${BASE}/api/auth/email-code`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email }),
})).json();
await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "DevUi@2026", deviceId, label: "界面余额设备", code: code.devCode }),
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
await s.send("Page.navigate", { url: `${BASE}/admin/devices` });
await poll(s, `document.body.innerText.includes("设备管理") && document.body.innerText.includes("积分余额")`);

await s.evaluate(`window.__row = (match) => [...document.querySelectorAll('.ant-table-tbody tr')].find(tr => tr.innerText.includes(match)) || null;
window.__clickInRow = (match, label) => {
  const row = window.__row(match);
  if (!row) throw new Error('row not found');
  const btn = [...row.querySelectorAll('button')].find(b => b.innerText.replace(/\\s+/g, '') === label);
  if (!btn) throw new Error('button not found: ' + label);
  btn.click(); return true;
}; 'ok'`);

const headers = await s.evaluate(`[...document.querySelectorAll('.ant-table-thead th')].map(th => th.innerText.trim())`);
check("表头包含积分余额", headers.includes("积分余额"), headers.join(" / "));

const rowText = await s.evaluate(`window.__row(${JSON.stringify(deviceId)})?.innerText || ""`);
check("设备行显示账号余额 1000", rowText.includes("1000"), rowText.replace(/\s+/g, " "));
check("设备行标记已登录账号", rowText.includes("已登录") && rowText.includes(email), rowText.replace(/\s+/g, " "));

await s.evaluate(`window.__clickInRow(${JSON.stringify(deviceId)}, '调整积分')`);
await poll(s, `document.querySelector('.ant-modal-content') !== null`);
const modalText = await s.evaluate(`document.querySelector('.ant-modal-content')?.innerText || ""`);
check("调分弹窗显示当前余额", modalText.includes("当前余额 1000"), modalText.replace(/\s+/g, " ").slice(0, 120));
check("调分弹窗提示记在账号上", modalText.includes("该设备已登录账号"), "");

await s.evaluate(`[...document.querySelectorAll('.ant-modal-footer button')].find(b => b.innerText.replace(/\\s+/g, '') === '确认调整').click(); 'ok'`);
const adjusted = await poll(s, `document.body.innerText.includes("当前余额 1100")`);
await sleep(500);
const afterText = await s.evaluate(`window.__row(${JSON.stringify(deviceId)})?.innerText || ""`);
check("调分后余额更新为 1100", adjusted && afterText.includes("1100"), afterText.replace(/\s+/g, " "));

// 通过账号接口复核
const accountRow = await (await fetch(`${BASE}/api/admin/devices?scope=device&q=${encodeURIComponent(deviceId)}`, {
  headers: { "X-Admin-Key": ADMIN_KEY },
})).json();
const row = accountRow.items?.[0];
const credits = await (await fetch(`${BASE}/api/admin/devices/${encodeURIComponent(row.accountDeviceId)}/transactions`, {
  headers: { "X-Admin-Key": ADMIN_KEY },
})).json();
check("服务端账号余额同步", credits.balance === 1100, String(credits.balance));

s.close();
await fetch(`${CDP}/json/close/${created.id}`).catch(() => {});

out.allPassed = out.steps.every((x) => x.ok);
await fs.writeFile(new URL("./device-balance-ui-report.json", import.meta.url), JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ allPassed: out.allPassed }, null, 2));
process.exit(out.allPassed ? 0 : 1);
