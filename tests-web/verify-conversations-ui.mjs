// 扩展端聊天记录同步验证：注册上传本机记录、换设备登录恢复、云端新版本覆盖、删除与账号隔离
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const PORT = 9333;
const TEST_SERVER = "http://127.0.0.1:5099";
const EXT = "jmgfklbjklbemmocojbpaajjpbobankp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const out = { steps: [], checks: [] };
function check(name, ok, detail) {
  out.checks.push({ name, ok: !!ok, detail });
  if (!ok) out.failed = (out.failed || 0) + 1;
}

async function list() {
  return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
      async evaluate(expr, timeout = 15000) {
        const r = await Promise.race([
          this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate timeout")), timeout)),
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
      return s;
    } catch { /* dead */ }
  }
  return null;
}

async function openPanel() {
  let s = await findPanel();
  if (s) return s;
  await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${EXT}/sidepanel/sidepanel.html`, { method: "PUT" });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    s = await findPanel();
    if (s) return s;
  }
  return null;
}

async function prepare(s) {
  await s.send("Page.enable").catch(() => {});
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
}

async function reload(s) {
  await s.send("Page.navigate", { url: `chrome-extension://${EXT}/sidepanel/sidepanel.html?v=${Date.now()}` });
  s.close();
  await sleep(1200);
  s = await openPanel();
  if (!s) throw new Error("导航后找不到面板");
  await prepare(s);
  return s;
}

async function waitFor(s, expr, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await s.evaluate(expr).catch(() => null);
    if (value) return value;
    await sleep(200);
  }
  return null;
}

const stamp = Date.now();
const emailA = `conv-ui-a-${stamp}@example.com`;
const emailB = `conv-ui-b-${stamp}@example.com`;
const password = "SpUiConv@2026";
const convId = randomUUID();

let s = await openPanel();
if (!s) {
  out.fatal = "找不到 sidepanel 目标";
} else {
  await prepare(s);
  const backup = await s.evaluate("chrome.storage.local.get(null)");
  out.backupKeys = Object.keys(backup || {});

  // 设备 A：清空会话与账号，写入一段本机聊天
  await s.evaluate(`chrome.storage.local.set(${JSON.stringify({
    server: TEST_SERVER,
    token: "",
    user: null,
    deviceId: randomUUID(),
    label: "同步测试设备 A",
    sessions: [{
      id: convId,
      title: "本机旧对话",
      updatedAt: Date.now() - 60_000,
      messages: [
        { role: "user", content: "设备 A 的问题", at: Date.now() - 120_000 },
        { role: "assistant", content: "设备 A 的回答", at: Date.now() - 119_000 },
      ],
    }],
    activeSession: convId,
    historyOwner: "",
    deletedConversations: {},
  })})`);
  s = await reload(s);

  await waitFor(s, `document.getElementById("popBalance")?.textContent !== "—"`);

  // 注册账号 A（未登录时本机会话应随注册并入云端）
  await s.evaluate(`(() => {
    document.getElementById("avatarDock").classList.add("open");
    document.getElementById("popAuth").click();
    document.querySelector('[data-auth-tab="register"]').click();
    document.getElementById("authEmail").value = ${JSON.stringify(emailA)};
    document.getElementById("authPassword").value = ${JSON.stringify(password)};
    document.getElementById("authSendCode").click();
  })()`);
  const codeFilled = await waitFor(s, `document.getElementById("authCode")?.value.length === 6`, 15000);
  check("注册页显示并自动填入验证码", !!codeFilled &&
    !(await s.evaluate(`document.getElementById("authCodeRow").hidden`)),
    await s.evaluate(`document.getElementById("authError")?.hidden ? "ok" : document.getElementById("authError").textContent`));
  await s.evaluate(`document.getElementById("authSubmit").click()`);
  const registered = await waitFor(s, `document.getElementById("logoutBtn")?.hidden === false`);
  check("注册成功", !!registered, await s.evaluate(`document.getElementById("authError")?.textContent`));
  await waitFor(s, `document.getElementById("status")?.textContent.includes("聊天记录已同步")`, 15000);
  const regStatus = await s.evaluate(`document.getElementById("status")?.textContent || ""`);
  check("注册提示赠送 1000 积分", regStatus.includes("已赠送 1000 积分"), regStatus);

  const serverList = async () => s.evaluate(`(async () => {
    const { token, server } = await chrome.storage.local.get(["token", "server"]);
    const r = await fetch(server + "/api/conversations", { headers: { Authorization: "Bearer " + token } });
    return r.json();
  })()`);
  const listA = await serverList();
  check("注册后本机记录已上传云端", Array.isArray(listA) && listA.some((x) => x.clientId === convId),
    listA);

  const storedA = await s.evaluate(`chrome.storage.local.get(["historyOwner"])`);
  check("记录账号归属", storedA.historyOwner === emailA.toLowerCase(), storedA.historyOwner);

  // 换设备 B：清空本机会话与账号态（模拟全新设备），再登录同一账号
  await s.evaluate(`chrome.storage.local.set(${JSON.stringify({
    token: "",
    user: null,
    deviceId: randomUUID(),
    label: "同步测试设备 B",
    sessions: [],
    activeSession: "",
    historyOwner: "",
    deletedConversations: {},
  })})`);
  s = await reload(s);
  await waitFor(s, `document.getElementById("popBalance")?.textContent !== "—"`);

  await s.evaluate(`(() => {
    document.getElementById("avatarDock").classList.add("open");
    document.getElementById("popAuth").click();
    document.querySelector('[data-auth-tab="login"]').click();
    document.getElementById("authEmail").value = ${JSON.stringify(emailA)};
    document.getElementById("authPassword").value = ${JSON.stringify(password)};
    document.getElementById("authSubmit").click();
  })()`);
  await waitFor(s, `document.getElementById("logoutBtn")?.hidden === false`);
  const syncedB = await waitFor(s, `document.getElementById("status")?.textContent.includes("聊天记录已同步")`);

  const restored = await s.evaluate(`(async () => {
    const { sessions, activeSession, historyOwner } = await chrome.storage.local.get(["sessions", "activeSession", "historyOwner"]);
    return {
      sessions: (sessions || []).map((x) => ({ id: x.id, title: x.title, messages: x.messages?.length })),
      activeSession,
      historyOwner,
      status: document.getElementById("status")?.textContent,
    };
  })()`);
  out.restored = restored;
  check("登录提示同步成功", !!syncedB, restored.status);
  check("换设备后恢复会话", restored.sessions?.length === 1 && restored.sessions[0]?.id === convId &&
    restored.sessions[0]?.messages === 2, restored.sessions);
  check("恢复后自动选中该会话", restored.activeSession === convId, restored.activeSession);

  // 历史面板提示与列表
  await s.evaluate(`(() => {
    document.getElementById("avatarDock").classList.add("open");
    document.querySelector('[data-pop="history"]').click();
  })()`);
  const historyUi = await s.evaluate(`({
    open: document.getElementById("historyDialog").open,
    tip: document.getElementById("historySync").textContent,
    items: [...document.querySelectorAll("#historyList li .item-main")].map((b) => b.textContent),
  })`);
  out.historyUi = historyUi;
  check("历史面板打开", historyUi.open === true, historyUi.open);
  check("历史面板显示登录同步提示", historyUi.tip.includes("已登录") && historyUi.tip.includes("同步到云端"), historyUi.tip);
  check("历史列表显示恢复的会话", historyUi.items.some((t) => t.includes("本机旧对话")), historyUi.items);

  // 云端出现更新版本 → 打开历史面板时拉取覆盖
  const remoteTitle = "云端更新版";
  await s.evaluate(`(async () => {
    const { token, server } = await chrome.storage.local.get(["token", "server"]);
    await fetch(server + "/api/conversations/" + ${JSON.stringify(convId)}, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        title: ${JSON.stringify(remoteTitle)},
        updatedAt: Date.now() + 5000,
        messages: [
          { role: "user", content: "设备 A 的问题" },
          { role: "assistant", content: "设备 A 的回答" },
          { role: "user", content: "另一台设备补充的问题" },
        ],
      }),
    });
  })()`);
  await s.evaluate(`document.getElementById("historyDialog").close()`);
  await s.evaluate(`(() => {
    document.getElementById("avatarDock").classList.add("open");
    document.querySelector('[data-pop="history"]').click();
  })()`);
  const pulled = await waitFor(s, `(async () => {
    const { sessions } = await chrome.storage.local.get("sessions");
    const s = (sessions || [])[0];
    return s && s.title === ${JSON.stringify(remoteTitle)} && s.messages?.length === 3;
  })()`, 12000);
  const afterPull = await s.evaluate(`(async () => {
    const { sessions } = await chrome.storage.local.get("sessions");
    return (sessions || []).map((x) => ({ title: x.title, messages: x.messages.length }));
  })()`);
  out.afterPull = afterPull;
  check("打开历史面板拉到云端新版本", !!pulled, afterPull);

  // 在面板里删除这条会话 → 云端也删除
  await s.evaluate(`document.querySelector("#historyList li .mini").click()`);
  const deletedRemote = await waitFor(s, `(async () => {
    const { token, server } = await chrome.storage.local.get(["token", "server"]);
    const r = await fetch(server + "/api/conversations/" + ${JSON.stringify(convId)}, { headers: { Authorization: "Bearer " + token } });
    return r.status === 404;
  })()`, 10000);
  const tomb = await s.evaluate(`chrome.storage.local.get("deletedConversations")`);
  check("面板删除同步到云端", !!deletedRemote, deletedRemote);
  check("删除留下墓碑", !!tomb.deletedConversations?.[convId], tomb.deletedConversations);

  // 账号隔离：退出后注册账号 B，本机不应保留 A 的记录（退出走设置页 + 确认框）
  await s.evaluate(`(() => {
    document.querySelector('#rail [data-view="settings"]').click();
    document.getElementById("logoutBtn").click();
    document.getElementById("logoutConfirm").click();
  })()`);
  await waitFor(s, `document.getElementById("logoutBtn")?.hidden === true`);
  await s.evaluate(`(() => {
    document.getElementById("avatarDock").classList.add("open");
    document.getElementById("popAuth").click();
    document.querySelector('[data-auth-tab="register"]').click();
    document.getElementById("authEmail").value = ${JSON.stringify(emailB)};
    document.getElementById("authPassword").value = ${JSON.stringify(password)};
    document.getElementById("authSendCode").click();
  })()`);
  await waitFor(s, `document.getElementById("authCode")?.value.length === 6`, 15000);
  await s.evaluate(`document.getElementById("authSubmit").click()`);
  await waitFor(s, `document.getElementById("logoutBtn")?.hidden === false`);
  await waitFor(s, `document.getElementById("status")?.textContent.includes("聊天记录已同步")`);
  const afterSwitch = await s.evaluate(`(async () => {
    const { sessions, historyOwner } = await chrome.storage.local.get(["sessions", "historyOwner"]);
    return { count: sessions?.length || 0, titles: (sessions || []).map((x) => x.title), historyOwner };
  })()`);
  out.afterSwitch = afterSwitch;
  check("切换账号后不保留上一账号记录", afterSwitch.count === 0, afterSwitch);
  check("账号归属切到新账号", afterSwitch.historyOwner === emailB.toLowerCase(), afterSwitch.historyOwner);

  // 恢复原状态
  await s.evaluate(`chrome.storage.local.clear().then(() => chrome.storage.local.set(${JSON.stringify(backup || {})}))`);
  s = await reload(s);
  await sleep(1200);
  out.restoredBackup = await s.evaluate(`({
    server: document.getElementById("serverInput")?.value || null,
    popAuthHidden: document.getElementById("popAuth")?.hidden,
    status: document.getElementById("status")?.textContent,
  })`);
  s.close();
}

out.summary = {
  total: out.checks.length,
  passed: out.checks.filter((c) => c.ok).length,
  failed: out.failed || 0,
};

await fs.writeFile("tests-web/conversations-ui-report.json", JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed ? 1 : 0);
