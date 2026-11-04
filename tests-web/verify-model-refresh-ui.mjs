// 扩展模型列表：打开菜单时实时从服务器拉取，后台增删模型无需重载插件
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const PORT = 9333;
const TEST_SERVER = "http://127.0.0.1:5096";
const DB = new URL("./tmp-model/sp-test.db", import.meta.url).pathname.replace(/^\//, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { steps: [] };

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

const check = (name, okValue, detail = "") => {
  out.steps.push({ name, ok: !!okValue, detail });
  console.log(`${okValue ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

const setModelEnabled = (enabled) => {
  execFileSync("sqlite3", [DB, `update Models set IsEnabled=${enabled ? 1 : 0} where ModelId='deepseek-v4-pro';`]);
  // 后台接口没有缓存，改库后立即生效
};

let found = await findPanel();
if (!found) {
  console.log("FAIL 找不到 sidepanel 目标");
  process.exit(1);
}
let s = found.s;
await s.send("Page.enable").catch(() => {});
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

const backup = await s.evaluate("chrome.storage.local.get(null)");
await s.evaluate(`chrome.storage.local.set(${JSON.stringify({
  server: TEST_SERVER,
  token: "",
  user: null,
  deviceId: randomUUID(),
  label: "模型刷新测试",
  model: "",
})})`);
await s.send("Page.navigate", { url: "chrome-extension://jmgfklbjklbemmocojbpaajjpbobankp/sidepanel/sidepanel.html?v=" + Date.now() });
s.close();
await sleep(2500);
found = await findPanel();
if (!found) {
  console.log("FAIL 导航后找不到面板");
  process.exit(1);
}
s = found.s;
await s.send("Page.enable").catch(() => {});
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

const menuModels = `[...document.querySelectorAll("#modelMenu .model-option")].map(b => b.dataset.model)`;
await waitFor(s, `document.querySelectorAll("#modelMenu .model-option").length > 0`);
const initial = await s.evaluate(menuModels);
check("启动时从服务器取到模型", initial.includes("deepseek-v4-pro"), initial.join(", "));

// 后台停用一个模型后，直接打开菜单（不重载插件）应该消失
setModelEnabled(false);
await s.evaluate(`document.getElementById("modelButton").click()`);
const removed = await waitFor(s, `${menuModels}.length > 0 && !${menuModels}.includes("deepseek-v4-pro")`);
const afterDisable = await s.evaluate(menuModels);
check("停用模型后菜单实时移除", !!removed, afterDisable.join(", "));

// 重新启用再打开菜单，应该回来
setModelEnabled(true);
const isOpen = await s.evaluate(`!document.getElementById("modelMenu").hidden`);
if (isOpen) await s.evaluate(`document.getElementById("modelButton").click()`);
await sleep(200);
await s.evaluate(`document.getElementById("modelButton").click()`);
const restored = await waitFor(s, `${menuModels}.includes("deepseek-v4-pro")`);
const afterEnable = await s.evaluate(menuModels);
check("重新启用后菜单实时恢复", !!restored, afterEnable.join(", "));

out.models = { initial, afterDisable, afterEnable };

// 恢复用户状态
await s.evaluate(`chrome.storage.local.clear().then(() => chrome.storage.local.set(${JSON.stringify(backup || {})}))`);
await s.send("Page.navigate", { url: "chrome-extension://jmgfklbjklbemmocojbpaajjpbobankp/sidepanel/sidepanel.html?v=" + Date.now() });
await sleep(2000);
s.close();

out.allPassed = out.steps.every((x) => x.ok);
await fs.writeFile(new URL("./model-refresh-ui-report.json", import.meta.url), JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ allPassed: out.allPassed }, null, 2));
process.exit(out.allPassed ? 0 : 1);
