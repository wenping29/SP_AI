const PORT = 9333;
const EXT = "jmgfklbjklbemmocojbpaajjpbobankp";
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
const panels = (await list()).filter((t) => t.type === "page" && /sidepanel\.html/.test(t.url || ""));
console.log("panel targets:", panels.length);
for (const t of panels) {
  try {
    const s = await connect(t);
    const info = await s.evaluate(`(async () => {
      const served = await fetch(location.href).then((r) => r.text());
      return {
        w: innerWidth,
        hasTitlebar: !!document.querySelector(".titlebar"),
        hasHeader: !!document.querySelector("header"),
        hasToolbar: !!document.querySelector(".toolbar"),
        servedHasPanelClose: served.includes("panelClose"),
        servedHasToolbar: served.includes("class=\\"toolbar\\""),
        ver: chrome.runtime.getManifest().version,
        extPath: chrome.runtime.getURL(""),
      };
    })()`);
    console.log(JSON.stringify(info));
    s.close();
  } catch (e) { console.log(t.webSocketDebuggerUrl.slice(-12), "ERR", e.message.slice(0, 100)); }
}
