// 直接调用某个 CDP 方法：node cdp-call.mjs <urlSubstr> <Method>
import fs from 'node:fs/promises';

const [,, urlSubstr, methodName = 'Page.bringToFront'] = process.argv;

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const target = targets.find((item) => item.url.includes(urlSubstr));
if (!target) {
  console.error('未找到目标：' + urlSubstr);
  process.exit(2);
}

const sock = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => sock.addEventListener('open', resolve, { once: true }));

const result = await new Promise((resolve) => {
  sock.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.id === 1) resolve(data);
  }, { once: false });
  sock.send(JSON.stringify({ id: 1, method: methodName, params: {} }));
});

console.log(JSON.stringify(result, null, 2).slice(0, 300));
sock.close();
