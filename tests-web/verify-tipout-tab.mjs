import fs from "node:fs/promises";
const PORT = 9333;
const EXT = "jmgfklbjklbemmocojbpaajjpbobankp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = `chrome-extension://${EXT}/sidepanel/sidepanel.html?verify=${Date.now()}`;
const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();

function connect(t) {
  return new Promise((resolve) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    ws.onopen = () => resolve({
      send: (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      close: () => ws.close(),
    });
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  });
}
const ev = async (s, expression) => {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value;
};

const s = await connect(created);
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
await s.send("Emulation.setDeviceMetricsOverride", { width: 382, height: 844, deviceScaleFactor: 1, mobile: false });

let ready = false;
for (let i = 0; i < 40 && !ready; i++) {
  ready = await ev(s, `!!document.getElementById("btnAdd") && !!document.querySelector(".composer-row.sendbar #btnAdd")`).catch(() => false);
  if (!ready) await sleep(200);
}
const state = await ev(s, `(() => {
  const btn = document.getElementById("btnAdd");
  const rules = [...document.styleSheets].flatMap((x) => { try { return [...x.cssRules].map((r) => r.selectorText || ""); } catch { return []; } });
  return { className: btn?.className, hasTipOut: rules.some((t) => t.includes("tip-out")), vw: innerWidth };
})()`);
const c = await ev(s, `(() => { const r = document.getElementById("btnAdd").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: c.x, y: c.y });
await sleep(400);
const after = await ev(s, `(() => { const st = getComputedStyle(document.getElementById("btnAdd"), "::after"); return { left: st.left, right: st.right, transform: st.transform, opacity: st.opacity }; })()`);
const shot = await s.send("Page.captureScreenshot", { format: "png" });
await fs.writeFile("composer-tipout.png", Buffer.from(shot.data, "base64"));
console.log(JSON.stringify({ ready, state, buttonCenter: c, after }, null, 2));
s.close();
await fetch(`http://127.0.0.1:${PORT}/json/close/${created.id}`);
