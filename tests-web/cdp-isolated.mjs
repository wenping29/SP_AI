// 在内容脚本所在的 isolated world 中求值：node cdp-isolated.mjs <urlSubstr> <extensionId> <exprFile>
import fs from 'node:fs/promises';

const [,, urlSubstr, extensionId, exprFile] = process.argv;
const expression = await fs.readFile(exprFile, 'utf8');

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const target = targets.find((item) => item.url.includes(urlSubstr));
if (!target) {
  console.error('未找到目标：' + urlSubstr);
  process.exit(2);
}

const sock = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const contexts = new Map();

sock.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id).resolve(data);
    pending.delete(data.id);
  }
  if (data.method === 'Runtime.executionContextCreated') {
    contexts.set(data.params.context.id, data.params.context);
  }
});

function send(method, params) {
  const id = ++nextId;
  sock.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((resolve) => pending.set(id, { resolve }));
}

await new Promise((resolve) => sock.addEventListener('open', resolve, { once: true }));
await send('Runtime.enable', {});
await new Promise((resolve) => setTimeout(resolve, 500));

// 逐个执行上下文探测：只有内容脚本的隔离世界里能拿到本扩展的 runtime.id
const probe = `(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || ''`;
let worldId = null;
for (const contextId of contexts.keys()) {
  const response = await send('Runtime.evaluate', { expression: probe, returnByValue: true, contextId });
  const value = response.result?.result?.value;
  if (value === extensionId) {
    worldId = contextId;
    break;
  }
}

if (worldId === null) {
  console.error(JSON.stringify({ error: '没找到该扩展的隔离世界', contexts: [...contexts.values()] }));
  process.exit(3);
}

const response = await send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  awaitPromise: true,
  contextId: worldId,
});

if (response.result?.exceptionDetails) {
  console.error('隔离世界执行出错：' + JSON.stringify(response.result.exceptionDetails).slice(0, 500));
  process.exit(4);
}
console.log(JSON.stringify({ worldId, value: response.result.result.value }, null, 2));
sock.close();
