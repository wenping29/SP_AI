// 扩展 UI 验证：头像浮层「登录 / 注册」入口、注册合并、退出（设置页 + 确认框）、再登录
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const PORT = 9333;
// 面板的服务器地址来自 edge/config.js 的 SERVER_URL（boot 时会覆盖 storage），这里保持一致
const TEST_SERVER = "http://127.0.0.1:5080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function list() {
  return (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
}

function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send: (method, params) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      async evaluate(expr) {
        const r = await Promise.race([
          this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate timeout")), 12000)),
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

async function findPanel() {
  for (const t of await list()) {
    if (t.type !== "page" || !/sidepanel\.html/.test(t.url || "") || !t.webSocketDebuggerUrl) continue;
    try {
      const s = await connect(t);
      await s.evaluate("1");
      return { s, t };
    } catch { /* dead */ }
  }
  return null;
}

async function waitFor(s, expr, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await s.evaluate(expr).catch(() => null);
    if (value) return value;
    await sleep(250);
  }
  return null;
}

const out = { steps: [] };
let found = await findPanel();
if (!found) {
  out.fatal = "找不到 sidepanel 目标";
} else {
  let s = found.s;
  await s.send("Page.enable").catch(() => {});
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

  // 备份原状态，测完恢复
  const backup = await s.evaluate("chrome.storage.local.get(null)");
  out.backupKeys = Object.keys(backup || {});

  const email = `sp-ui-${Date.now()}@example.com`;
  const password = "SpUi@2026";

  await s.evaluate(`chrome.storage.local.set(${JSON.stringify({
    server: TEST_SERVER,
    token: "",
    user: null,
    deviceId: randomUUID(),
    label: "自动化测试设备",
  })})`);
  await s.send("Page.navigate", { url: "chrome-extension://jmgfklbjklbemmocojbpaajjpbobankp/sidepanel/sidepanel.html?v=" + Date.now() });
  s.close();
  await sleep(2200);
  found = await findPanel();
  if (!found) {
    out.fatal = "导航后找不到面板";
  } else {
    s = found.s;
    await s.send("Page.enable").catch(() => {});
    await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

    await waitFor(s, `document.getElementById("popBalance")?.textContent !== "—"`);

    out.start = await s.evaluate(`(() => ({
      balance: document.getElementById("popBalance")?.textContent,
      popAuthHidden: document.getElementById("popAuth")?.hidden,
      logoutHidden: document.getElementById("logoutBtn")?.hidden,
      device: document.getElementById("popDevice")?.textContent,
      hasAuthItem: !!document.getElementById("popAuth"),
    }))()`);

    // 打开头像浮层 → 点击登录 / 注册
    const opened = await s.evaluate(`(() => {
      document.getElementById("avatarDock").classList.add("open");
      document.getElementById("popAuth").click();
      const d = document.getElementById("authDialog");
      return {
        open: d.open,
        title: document.getElementById("authTitle").textContent,
        nameRowHidden: document.getElementById("authNameRow").hidden,
        activeTab: document.querySelector("[data-auth-tab].active")?.dataset.authTab,
      };
    })()`);
    out.dialogLogin = opened;

    // 切到注册、填表提交
    await s.evaluate(`(() => {
      document.querySelector('[data-auth-tab="register"]').click();
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; };
      set("authEmail", ${JSON.stringify(email)});
      set("authName", "UI 测试用户");
      set("authPassword", ${JSON.stringify(password)});
      return {
        title: document.getElementById("authTitle").textContent,
        nameRowVisible: !document.getElementById("authNameRow").hidden,
        codeRowVisible: !document.getElementById("authCodeRow").hidden,
        submitText: document.getElementById("authSubmit").textContent,
      };
    })()`).then((v) => { out.registerMode = v; });

    // 发送邮箱验证码（测试服务器 ExposeDevCode 会自动填入）
    await s.evaluate(`document.getElementById("authSendCode").click()`);
    await waitFor(s, `document.getElementById("authCode")?.value.length === 6`, 12000);
    out.codeSent = await s.evaluate(`({
      value: document.getElementById("authCode").value,
      status: document.getElementById("status").textContent,
    })`);

    await s.evaluate(`document.getElementById("authSubmit").click()`);
    await waitFor(s, `document.getElementById("logoutBtn")?.hidden === false`, 15000);

    out.afterRegister = await s.evaluate(`(async () => {
      const stored = await chrome.storage.local.get(["token", "user", "server"]);
      return {
        dialogOpen: document.getElementById("authDialog").open,
        popAuthHidden: document.getElementById("popAuth").hidden,
        accountName: document.getElementById("popDevice").textContent,
        balance: document.getElementById("popBalance").textContent,
        status: document.getElementById("status").textContent,
        storedUser: stored.user,
        rechargeId: document.getElementById("rechargeDevice").value,
        authError: document.getElementById("authError").hidden ? "" : document.getElementById("authError").textContent,
      };
    })()`);

    // 服务端余额核对
    out.serverCredits = await s.evaluate(`(async () => {
      const { token, server } = await chrome.storage.local.get(["token", "server"]);
      const res = await fetch(server + "/api/credits", { headers: { Authorization: "Bearer " + token } });
      return res.json();
    })()`);

    // 退出登录：设置页（二级）点「退出登录」→ 确认框（三级）再确认
    out.logoutFirstClick = await s.evaluate(`(() => {
      document.querySelector('#rail [data-view="settings"]').click();
      document.getElementById("logoutBtn").click();
      return {
        settingsVisible: !document.getElementById("settingsView").hidden,
        accountEmail: document.getElementById("accountEmail").value,
        dialogOpen: document.getElementById("logoutDialog").open,
        stillLoggedIn: document.getElementById("popAuth").hidden,
      };
    })()`);
    await sleep(200);
    await s.evaluate(`document.getElementById("logoutCancel").click()`);
    await sleep(200);
    out.logoutCancel = await s.evaluate(`({
      dialogOpen: document.getElementById("logoutDialog").open,
      popAuthHidden: document.getElementById("popAuth").hidden,
      accountName: document.getElementById("popDevice").textContent,
    })`);
    await s.evaluate(`document.getElementById("logoutBtn").click()`);
    await sleep(200);
    await s.evaluate(`document.getElementById("logoutConfirm").click()`);
    await waitFor(s, `document.getElementById("logoutBtn")?.hidden === true`, 10000);

    out.afterLogout = await s.evaluate(`(async () => ({
      popAuthHidden: document.getElementById("popAuth").hidden,
      accountName: document.getElementById("popDevice").textContent,
      balance: document.getElementById("popBalance").textContent,
      status: document.getElementById("status").textContent,
      storedUser: (await chrome.storage.local.get("user")).user ?? null,
      serverUser: await (async () => {
        const { token, server } = await chrome.storage.local.get(["token", "server"]);
        const r = await fetch(server + "/api/auth/me", { headers: { Authorization: "Bearer " + token } });
        return r.json();
      })(),
    }))()`);

    // 再次登录（合并 0 积分）
    await s.evaluate(`(() => {
      document.getElementById("avatarDock").classList.add("open");
      document.getElementById("popAuth").click();
      document.querySelector('[data-auth-tab="login"]').click();
      document.getElementById("authEmail").value = ${JSON.stringify(email)};
      document.getElementById("authPassword").value = ${JSON.stringify(password)};
      document.getElementById("authSubmit").click();
    })()`);
    await waitFor(s, `document.getElementById("logoutBtn")?.hidden === false`, 12000);
    out.afterRelogin = await s.evaluate(`({
      popAuthHidden: document.getElementById("popAuth").hidden,
      accountName: document.getElementById("popDevice").textContent,
      balance: document.getElementById("popBalance").textContent,
      status: document.getElementById("status").textContent,
    })`);

    // 恢复原状态并重新加载，避免污染用户真实面板
    await s.evaluate(`chrome.storage.local.clear().then(() => chrome.storage.local.set(${JSON.stringify(backup || {})}))`);
    await s.send("Page.navigate", { url: "chrome-extension://jmgfklbjklbemmocojbpaajjpbobankp/sidepanel/sidepanel.html?v=" + Date.now() });
    await sleep(2500);
    s.close();
    found = await findPanel();
    if (found) {
      out.restored = await found.s.evaluate(`({
        server: document.getElementById("serverInput")?.value || null,
        status: document.getElementById("status")?.textContent,
        popAuthHidden: document.getElementById("popAuth")?.hidden,
        balance: document.getElementById("popBalance")?.textContent,
      })`);
      found.s.close();
    } else {
      out.restored = "找不到恢复后的面板";
    }
  }
}

await fs.writeFile("auth-ui-report.json", JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify(out, null, 2));
process.exit(0);
