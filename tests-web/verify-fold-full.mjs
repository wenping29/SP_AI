// 验证右侧功能栏的折叠 / 全页模式：node verify-fold-full.mjs
import fs from "node:fs/promises";

const PORT = 9333;
const EXT = "jmgfklbjklbemmocojbpaajjpbobankp";
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const i = ++id;
        pending.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
      close: () => ws.close(),
    });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    };
    ws.onerror = () => reject(new Error("ws error"));
  });
}

async function findPanel() {
  const targets = await list();
  const target = targets.find((t) => t.type === "page" && /sidepanel\/sidepanel\.html/.test(t.url || ""));
  if (!target) throw new Error("没有打开的面板页面");
  return target;
}

async function openSession(target) {
  const s = await connect(target);
  await s.send("Page.enable");
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  return s;
}

async function evalIn(s, expression) {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
  return r.result.value;
}

async function waitFor(s, expression, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evalIn(s, expression).catch(() => false)) return true;
    await sleep(120);
  }
  return false;
}

async function shot(s, file) {
  const data = await s.send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(file, Buffer.from(data.data, "base64"));
}

const report = {};

// 1. 强制重载面板（扩展页面可能一直是旧 DOM）
let panel = await findPanel();
let s = await openSession(panel);
await s.send("Page.navigate", { url: `chrome-extension://${EXT}/sidepanel/sidepanel.html?v=${Date.now()}` });
s.close();
await sleep(1500);
panel = await findPanel();
s = await openSession(panel);
report.pageReloaded = await waitFor(s, `!!document.getElementById("railFold")`);

report.railTop = await evalIn(s, `[...document.querySelectorAll(".rail-top button")].map((b) => ({
  id: b.id, tip: b.dataset.tip, pressed: b.getAttribute("aria-pressed"),
  svg: !!b.querySelector("svg"), w: Math.round(b.getBoundingClientRect().width),
}))`);
report.before = await evalIn(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  mainDisplay: getComputedStyle(document.querySelector(".main")).display,
  railRect: (() => { const r = document.getElementById("rail").getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }; })(),
  vw: innerWidth,
})`);

// 2. 折叠
await evalIn(s, `document.getElementById("railFold").click()`);
await sleep(250);
report.collapsed = await evalIn(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  mainDisplay: getComputedStyle(document.querySelector(".main")).display,
  tip: document.getElementById("railFold").dataset.tip,
  pressed: document.getElementById("railFold").getAttribute("aria-pressed"),
  icon: document.querySelector("#railFold svg path").getAttribute("d"),
  railRight: Math.round(document.getElementById("rail").getBoundingClientRect().right),
  vw: innerWidth,
  stored: null,
})`);
report.collapsed.stored = await evalIn(s, `chrome.storage.local.get("panelCollapsed").then((s) => s.panelCollapsed)`);
await shot(s, "D:/Project/sp/tests-web/fold-collapsed.png");

// 3. 点空白处展开
await evalIn(s, `document.querySelector(".layout").dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
await sleep(200);
report.expandedByBlankClick = await evalIn(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  mainDisplay: getComputedStyle(document.querySelector(".main")).display,
  tip: document.getElementById("railFold").dataset.tip,
})`);

// 4. 全页模式：点按钮应新开一个 ?full=1 的标签页
const beforeIds = new Set((await list()).map((t) => t.id));
await evalIn(s, `document.getElementById("railFull").click()`);
let fullTarget = null;
for (let i = 0; i < 30 && !fullTarget; i++) {
  await sleep(200);
  fullTarget = (await list()).find((t) => t.id !== panel.id && !beforeIds.has(t.id) && /sidepanel\.html\?full=1/.test(t.url || ""));
}
if (fullTarget) {
  const fs2 = await openSession(fullTarget);
  await fs2.send("Page.navigate", { url: `chrome-extension://${EXT}/sidepanel/sidepanel.html?full=1&v=${Date.now()}` });
  fs2.close();
  await sleep(1200);
  fullTarget = (await list()).find((t) => /sidepanel\.html\?full=1/.test(t.url || ""));
  const f = await openSession(fullTarget);
  await waitFor(f, `!!document.getElementById("railFold")`);
  report.fullPage = await evalIn(f, `({
    dataset: document.documentElement.dataset.full,
    railTopDisplay: getComputedStyle(document.querySelector(".rail-top")).display,
    layoutWidth: Math.round(document.querySelector(".layout").getBoundingClientRect().width),
    layoutMaxWidth: getComputedStyle(document.querySelector(".layout")).maxWidth,
    layoutLeft: Math.round(document.querySelector(".layout").getBoundingClientRect().left),
    innerWidth,
    foldVisible: document.getElementById("railFold").offsetParent !== null,
  })`);
  await shot(f, "D:/Project/sp/tests-web/fold-fullpage.png");
  f.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${fullTarget.id}`);
} else {
  report.fullPage = { error: "没有检测到新开的全页标签页" };
}

// 5. 收尾：确保面板是展开状态
await evalIn(s, `document.querySelector(".layout").classList.contains("collapsed") && document.getElementById("railFold").click()`);
report.final = await evalIn(s, `({
  collapsed: document.querySelector(".layout").classList.contains("collapsed"),
  stored: null,
})`);
report.final.stored = await evalIn(s, `chrome.storage.local.get("panelCollapsed").then((v) => v.panelCollapsed)`);

s.close();
console.log(JSON.stringify(report, null, 2));
