import fs from "node:fs/promises";
const PORT = 9333;
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send: (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      close: () => ws.close(),
    });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onerror = () => reject(new Error("ws"));
  });
}
for (const t of await list()) {
  if (t.type !== "page" || !/sidepanel\.html/.test(t.url || "")) continue;
  const s = await connect(t);
  await s.send("Page.enable");
  await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  const shot = await s.send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("sider-layout.png", Buffer.from(shot.data, "base64"));
  console.log("saved", shot.data.length, "bytes");
  s.close();
  break;
}
