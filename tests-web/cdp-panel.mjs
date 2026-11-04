// 用 CDP 驱动已加载扩展的 Edge 标签页：node cdp-panel.mjs <urlSubstr> <exprFile>
const [,, urlSubstr = 'sidepanel', exprFile] = process.argv;

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const target = targets.find((item) => item.type === 'page' && item.url.includes(urlSubstr));
if (!target) {
  console.error('未找到目标标签页：' + urlSubstr);
  process.exit(2);
}

const fs = await import('node:fs/promises');
const expression = exprFile
  ? await fs.readFile(exprFile, 'utf8')
  : '(() => document.title)()';

const sock = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();

sock.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const handlers = pending.get(data.id);
    pending.delete(data.id);
    handlers.resolve(data);
  }
});

function send(method, params) {
  const id = ++nextId;
  sock.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((resolve) => pending.set(id, { resolve }));
}

await new Promise((resolve) => sock.addEventListener('open', resolve, { once: true }));

const response = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
});

const evaluated = response.result;
if (evaluated.exceptionDetails) {
  console.error('页面执行出错：' + JSON.stringify(evaluated.exceptionDetails).slice(0, 600));
  process.exit(3);
}
console.log(JSON.stringify(evaluated.result.value, null, 2));
sock.close();
