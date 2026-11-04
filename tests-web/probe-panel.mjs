const PORT = 9333;
async function list() { return (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()); }
function connect(t) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send: (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); }),
      async evaluate(e) { const r = await this.send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error"); return r.result?.value; },
      close: () => ws.close(),
    });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    ws.onerror = () => reject(new Error("ws"));
  });
}
for (const t of await list()) {
  if (t.type !== "page" || !/sidepanel\.html/.test(t.url || "")) continue;
  const s = await connect(t);
  const info = await s.evaluate(`(() => ({
    url: location.href,
    w: innerWidth,
    readyState: document.readyState,
    hasTitlebar: !!document.querySelector(".titlebar"),
    hasToolbar: !!document.querySelector(".toolbar"),
    ids: ["panelClose","viewTitle","newChat","input","send"].map(i => i + ":" + !!document.getElementById(i)),
    bodyFirst: document.querySelector(".main")?.firstElementChild?.outerHTML?.slice(0, 200) || null,
  }))()`);
  console.log(JSON.stringify(info, null, 2));
  s.close();
}
