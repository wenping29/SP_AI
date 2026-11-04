import fs from "node:fs/promises";

const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function list() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      send: (method, params) => new Promise((res2, rej2) => {
        const mid = ++id;
        pending.set(mid, { res2, rej2 });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      async evaluate(expr) {
        const r = await Promise.race([
          this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate timeout")), 8000)),
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
        m.error ? p.rej2(new Error(m.error.message)) : p.res2(m.result);
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
      const w = await s.evaluate("({w: innerWidth, h: innerHeight})");
      if (w.w < 600) return { s, t, docked: true };
      s.close();
    } catch { /* dead target, skip */ }
  }
  return null;
}

async function openPanelTab() {
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const s = await connect(ver);
  const r = await s.send("Target.createTarget", {
    url: "chrome-extension://jmgfklbjklbemmocojbpaajjpbobankp/sidepanel/sidepanel.html",
  });
  s.close();
  await sleep(800);
  const t = (await list()).find((x) => x.type === "page" && x.id === r.targetId && x.webSocketDebuggerUrl);
  return t ? { s: await connect(t), t, docked: false } : null;
}

const out = { steps: [] };

let found = await findPanel();
if (!found) {
  found = await openPanelTab();
  out.panelMode = found ? "tab" : null;
}
if (!found) { out.fatal = "无法打开面板"; }
else {
  let s = found.s;
  // 面板可能挂着旧文档：带 cache-buster 强制重新加载
  const url = await s.evaluate('location.origin + "/sidepanel/sidepanel.html?v=" + Date.now()');
  await s.send("Page.enable").catch(() => {});
  await s.send("Page.navigate", { url }).catch(() => {});
  s.close();
  await sleep(2000);
  // 导航可能换掉目标，重连
  found = await findPanel() || (await openPanelTab());
  if (!found) { out.fatal = "导航后找不到面板"; await fs.writeFile("sider-layout-report.json", JSON.stringify(out, null, 2), "utf8"); process.exit(1); }
  s = found.s;

  // 1) 面板加载健康：boot 跑完（状态不再是准备中）、无崩溃残留、无标题栏
  out.health = await s.evaluate(`(() => ({
    noTitlebar: !document.querySelector(".titlebar"),
    status: document.getElementById("status")?.textContent || null,
    hasRail: !!document.getElementById("rail"),
    hasAvatar: !!document.getElementById("avatar"),
    hasModel: !!document.getElementById("model"),
    modelOptions: document.getElementById("model")?.options.length ?? 0,
  }))()`);

  // 2) 新建聊天 → 空会话应出现居中引导区
  await s.evaluate(`(() => { document.getElementById("newChat").click(); return 1; })()`);
  await sleep(250);
  out.hero = await s.evaluate(`(() => {
    const hero = document.querySelector(".empty-hero");
    return {
      present: !!hero,
      h2: hero?.querySelector("h2")?.textContent || null,
      chipCount: hero?.querySelectorAll(".hero-chips button").length ?? 0,
      hintGone: !document.querySelector(".thread .hint"),
    };
  })()`);

  // 3) 点第一条快捷提问：填输入框 + 自动开启阅读此页
  out.chipClick = await s.evaluate(`(() => {
    const chip = document.querySelector(".hero-chips button");
    if (!chip) return { clicked: false };
    const text = chip.textContent;
    chip.click();
    return {
      clicked: true,
      inputFilled: document.getElementById("input").value === text,
      readPageOn: document.getElementById("btnReadPage").getAttribute("aria-pressed") === "true",
    };
  })()`);

  s.close();
}

await fs.writeFile("sider-layout-report.json", JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify(out, null, 2));
