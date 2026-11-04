// 验证：设置按钮位于右侧栏头像正上方
import fs from "node:fs/promises";

const PORT = 9333;
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
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    };
    ws.onerror = (err) => reject(new Error("ws error: " + (err?.message || err)));
  });
}

const out = { steps: [] };
const target = (await list()).find((t) => t.type === "page" && /sidepanel\.html/.test(t.url || "") && t.webSocketDebuggerUrl);
if (!target) {
  out.fatal = "找不到 sidepanel 目标";
} else {
  const s = await connect(target);
  await s.send("Page.enable").catch(() => {});
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  await s.send("Page.navigate", { url: target.url.split("?")[0] + "?v=" + Date.now() }).catch(() => {});
  s.close();
  await sleep(1800);

  const reopened = (await list()).find((t) => t.type === "page" && /sidepanel\.html/.test(t.url || "") && t.webSocketDebuggerUrl);
  if (!reopened) {
    out.fatal = "导航后找不到面板";
  } else {
    const p = await connect(reopened);
    await p.send("Page.enable").catch(() => {});
    await p.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await p.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

    out.layout = await p.evaluate(`(() => {
      const rail = document.getElementById("rail");
      const gear = rail.querySelector('button[data-view="settings"]');
      const avatar = document.getElementById("avatar");
      const dock = document.getElementById("avatarDock");
      const tools = rail.querySelector('button[data-view="tools"]');
      const rr = rail.getBoundingClientRect(), gr = gear.getBoundingClientRect();
      const ar = avatar.getBoundingClientRect(), tr = tools.getBoundingClientRect();
      const order = [...rail.children].map((n) => n.id || n.dataset.view || n.className);
      return {
        order,
        gearMarginTop: getComputedStyle(gear).marginTop,
        dockMarginTop: getComputedStyle(dock).marginTop,
        gearBox: [Math.round(gr.top), Math.round(gr.bottom)],
        avatarBox: [Math.round(ar.top), Math.round(ar.bottom)],
        toolsBox: [Math.round(tr.top), Math.round(tr.bottom)],
        railBox: [Math.round(rr.top), Math.round(rr.bottom)],
        gearDirectlyAboveAvatar: gr.bottom <= ar.top && ar.top - gr.bottom <= 12,
        gearBelowTools: gr.top > tr.bottom,
        gearGapToRailBottom: Math.round(rr.bottom - gr.bottom),
        avatarGapToRailBottom: Math.round(rr.bottom - ar.bottom),
        gearVisible: gr.width > 0 && gr.height > 0,
      };
    })()`);

    // 点击齿轮仍应切换到设置页
    out.click = await p.evaluate(`(() => {
      const gear = document.querySelector('#rail button[data-view="settings"]');
      gear.click();
      return {
        active: gear.classList.contains("active"),
        settingsVisible: !document.getElementById("settingsView").hidden,
        chatHidden: document.getElementById("chatView").hidden,
      };
    })()`);
    await sleep(150);

    // 切回聊天，保持原视图
    await p.evaluate(`document.querySelector('#rail button[data-view="chat"]').click()`);

    const shot = await p.send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile("rail-settings.png", Buffer.from(shot.data, "base64"));
    out.shot = "rail-settings.png";
    p.close();
  }
}

await fs.writeFile("rail-settings-report.json", JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify(out, null, 2));
process.exit(0);
