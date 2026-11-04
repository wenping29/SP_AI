// 在指定页面派发真实鼠标事件：node cdp-click.mjs <urlSubstr> <x> <y>
const [,, urlSubstr, xArg, yArg] = process.argv;
const x = Number(xArg);
const y = Number(yArg);

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const target = targets.find((item) => item.type === 'page' && item.url.includes(urlSubstr));
if (!target) {
  console.error('未找到目标页面：' + urlSubstr);
  process.exit(2);
}

const sock = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();

sock.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id).resolve(data);
    pending.delete(data.id);
  }
});

function send(method, params) {
  const id = ++nextId;
  sock.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, { resolve }));
}

await new Promise((resolve) => sock.addEventListener('open', resolve, { once: true }));
await send('Page.enable', {});

const base = { x, y, buttons: 'left', clickCount: 1, pointerEventsOnly: false };
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });

console.log(JSON.stringify({ clickedAt: { x, y } }));
sock.close();
