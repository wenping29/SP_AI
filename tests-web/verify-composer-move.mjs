import fs from "node:fs/promises";
const PORT = 9333;
const EXT = "jmgfklbjklbemmocojbpaajjpbobankp";
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close(),
    });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onerror = () => reject(new Error("ws"));
  });
}
const findPanel = async () => (await list()).find((t) => t.type === "page" && /sidepanel\/sidepanel\.html/.test(t.url || ""));
const ev = async (s, expression) => {
  const r = await s.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "failed");
  return r.result.value;
};
const waitFor = async (s, expression, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(s, expression).catch(() => false)) return true; await sleep(120); }
  return false;
};

let s = await connect(await findPanel());
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
await s.send("Page.navigate", { url: `chrome-extension://${EXT}/sidepanel/sidepanel.html?v=${Date.now()}` });
s.close();
await sleep(1500);
s = await connect(await findPanel());
await s.send("Page.enable");
await s.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
await s.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
const ready = await waitFor(s, `!!document.getElementById("btnAdd")`);

const geometry = await ev(s, `(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const status = document.getElementById("status"), add = document.getElementById("btnAdd"), file = document.getElementById("btnFile");
  const voice = document.getElementById("btnVoice"), send = document.getElementById("send");
  const controls = document.querySelector(".composer-row.controls"), sendbar = document.querySelector(".composer-row.sendbar");
  return {
    addParentClass: add.parentElement.className,
    fileParentClass: file.parentElement.className,
    addStillInControls: controls.contains(add),
    addAfterStatus: add.getBoundingClientRect().left >= status.getBoundingClientRect().right - 1,
    fileAfterAdd: file.getBoundingClientRect().left >= add.getBoundingClientRect().right - 1,
    sameRowAsSend: Math.abs(add.getBoundingClientRect().top - send.getBoundingClientRect().top) < 12,
    voicePushedRight: voice.getBoundingClientRect().left - file.getBoundingClientRect().right > 100,
    boxes: { status: box(status), add: box(add), file: box(file), voice: box(voice), send: box(send), controls: box(controls), sendbar: box(sendbar) },
    controlsButtons: [...controls.querySelectorAll("button")].map((b) => b.id || b.dataset.icon),
    sendbarButtons: [...sendbar.querySelectorAll("button")].map((b) => b.id || b.dataset.icon),
  };
})()`);

// 「+」菜单应从按钮上方弹出
await ev(s, `document.getElementById("btnAdd").click()`);
await sleep(250);
const menu = await ev(s, `(() => {
  const m = document.getElementById("addMenu");
  const r = m.getBoundingClientRect(), b = document.getElementById("btnAdd").getBoundingClientRect();
  return {
    hidden: m.hidden,
    opensUpward: Math.round(r.bottom) <= Math.round(b.top) + 1,
    inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
    expanded: document.getElementById("btnAdd").getAttribute("aria-expanded"),
    box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    btn: { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) },
  };
})()`);
await ev(s, `document.getElementById("btnAdd").click()`);
await sleep(150);

const shot = await s.send("Page.captureScreenshot", { format: "png" });
await fs.writeFile("composer-move.png", Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({ ready, geometry, menu }, null, 2));
s.close();
