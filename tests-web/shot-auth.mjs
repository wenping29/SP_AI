import fs from "node:fs/promises";
const PORT = 9333;
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send: (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      async ev(x) {
        const r = await this.send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval");
        return r.result?.value;
      },
      close: () => ws.close(),
    });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onerror = () => reject(new Error("ws"));
  });
}
const t = (await list()).find((x) => x.type === "page" && /sidepanel\.html/.test(x.url || ""));
const s = await connect(t);
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

await s.ev(`(() => { document.getElementById("avatarDock").classList.add("open"); return 1; })()`);
const pop = await s.send("Page.captureScreenshot", { format: "png" });
await fs.writeFile("auth-pop.png", Buffer.from(pop.data, "base64"));

await s.ev(`(() => { document.getElementById("popAuth").click(); document.querySelector('[data-auth-tab="register"]').click(); return 1; })()`);
const dlg = await s.send("Page.captureScreenshot", { format: "png" });
await fs.writeFile("auth-dialog.png", Buffer.from(dlg.data, "base64"));

const state = await s.ev(`(() => ({
  dialogOpen: document.getElementById("authDialog").open,
  nameRowVisible: !document.getElementById("authNameRow").hidden,
  dialogRect: (() => { const r = document.getElementById("authDialog").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}))()`);
await s.ev(`document.getElementById("authDialog").close(); document.getElementById("avatarDock").classList.remove("open");`);
s.close();
console.log(JSON.stringify(state));
process.exit(0);
