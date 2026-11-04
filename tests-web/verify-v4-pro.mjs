const PORT = 9333;
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const t = (await list()).find((x) => x.type === "page" && /sidepanel\/sidepanel\.html(?!\?full=1)/.test(x.url || ""));
if (!t) {
  console.log("no panel target");
  process.exit(0);
}
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++id;
  pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id);
    pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const result = await ev(`(async () => {
  const auth = { Authorization: "Bearer " + state.token };
  const before = await (await fetch(state.server + "/api/credits", { headers: auth })).json();
  const response = await fetch(state.server + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ model: "deepseek-v4-pro", messages: [{ role: "user", content: "只回复两个字母：OK" }], maxTokens: 128 }),
  });
  const body = await response.text();
  const events = body.split(/\\n\\n/).map((chunk) => chunk.replace(/^data:\\s*/, "").trim()).filter(Boolean).map((raw) => {
    try { return JSON.parse(raw); } catch { return { type: "unparsed", raw: raw.slice(0, 80) }; }
  });
  const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  const error = events.find((e) => e.type === "error")?.error || "";
  const done = events.find((e) => e.type === "done") || null;
  const after = await (await fetch(state.server + "/api/credits", { headers: auth })).json();
  return { http: response.status, contentType: response.headers.get("content-type"), before: before.balance, after: after.balance, text: text.slice(0, 80), error, usage: done?.usage || null };
})()`);
console.log(JSON.stringify(result, null, 2));
ws.close();
process.exit(0);
