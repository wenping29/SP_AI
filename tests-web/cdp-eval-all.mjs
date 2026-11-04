// 对所有匹配页面求值：node cdp-eval-all.mjs <urlSubstr> <exprFile>
import fs from 'node:fs/promises';

const [,, urlSubstr, exprFile] = process.argv;
const expression = await fs.readFile(exprFile, 'utf8');

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const matches = targets.filter((item) => item.url.includes(urlSubstr));
if (!matches.length) {
  console.error('没有匹配目标：' + urlSubstr);
  process.exit(2);
}

const results = [];
for (const target of matches) {
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => sock.addEventListener('open', resolve, { once: true }));

  const response = await new Promise((resolve) => {
    sock.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id === 1) resolve(data);
    });
    sock.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
  sock.close();

  const evaluated = response.result;
  results.push({
    targetId: target.id.slice(0, 8),
    value: evaluated.result?.value ?? null,
    error: evaluated.exceptionDetails
      ? (evaluated.exceptionDetails.exception?.description || '').slice(0, 120)
      : undefined,
  });
}

console.log(JSON.stringify(results, null, 2));
