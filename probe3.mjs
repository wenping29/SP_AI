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
const t = (await list()).find((x) => x.type === "page" && /sidepanel\.html/.test(x.url || ""));
const s = await connect(t);
const r1 = await s.evaluate(`(() => ({ href: location.href.slice(-40), hasTitlebar: !!document.querySelector(".titlebar"), mainChildren: [...document.querySelector(".main").children].map((c) => c.tagName + "." + c.className) }))()`);
console.log("before:", JSON.stringify(r1));
await s.send("Page.enable");
const nav = await s.send("Page.navigate", { url: await s.evaluate('location.origin + "/sidepanel/sidepanel.html?v=" + Date.now()') });
console.log("nav result:", JSON.stringify(nav));
await new Promise((r) => setTimeout(r, 2000));
const r2 = await s.evaluate(`(() => ({ href: location.href.slice(-40), hasTitlebar: !!document.querySelector(".titlebar"), mainChildren: [...document.querySelector(".main").children].map((c) => c.tagName + "." + c.className) }))()`);
console.log("after:", JSON.stringify(r2));
s.close();
