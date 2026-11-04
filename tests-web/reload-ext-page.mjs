// 通过 edge://extensions 页面点「重新加载」按钮，让 Chrome/Edge 重新读取磁盘上的扩展代码
// node reload-ext-page.mjs <extensionId>
const [,, EXT] = process.argv;
const DEBUG = process.env.CDP || 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) { this.pending.get(data.id)(data); this.pending.delete(data.id); }
    });
  }

  async open() { await new Promise((r) => this.ws.addEventListener('open', r, { once: true })); }

  send(method, params) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => this.pending.set(id, r));
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.error) return { __cdp: response.error.message };
    const detail = response.result?.exceptionDetails;
    if (detail) return { __error: (detail.exception?.description || detail.text || '').slice(0, 300) };
    return response.result?.result?.value ?? null;
  }

  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());

let target = (await list()).find((t) => /edge:\/\/extensions|chrome:\/\/extensions/.test(t.url));
if (!target) {
  target = await (await fetch(`${DEBUG}/json/new?edge://extensions`, { method: 'PUT' })).json();
  await sleep(3500);
}

const page = new Session(target.webSocketDebuggerUrl);
await page.open();

const findExpr = `(() => {
  const hits = [];
  const walk = (root, depth) => {
    if (depth > 14) return;
    for (const node of root.querySelectorAll('*')) {
      const label = (node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title') || '')) || '';
      if (/重新加载|Reload/i.test(label)) {
        const rect = node.getBoundingClientRect();
        hits.push({ label, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), w: Math.round(rect.width) });
      }
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
    }
  };
  walk(document, 0);
  return { count: hits.length, hits: hits.slice(0, 12) };
})()`;

let found = await page.evaluate(findExpr);
if (!found?.count) {
  await page.send('Page.bringToFront');
  await sleep(2500);
  found = await page.evaluate(findExpr);
}

// 页面里有多个「重新加载」（每个扩展一个），按卡片顺序定位开发加载的那一条
const names = await page.evaluate(`(() => {
  const items = [];
  const walk = (root, depth) => {
    if (depth > 14) return;
    for (const node of root.querySelectorAll('*')) {
      if (node.id === 'extension-icon' || /extensions-item/i.test(node.tagName || '')) {
        const name = node.shadowRoot?.querySelector?.('#name')?.textContent || node.textContent || '';
        if (name.trim()) items.push(name.trim().slice(0, 30));
      }
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
    }
  };
  walk(document, 0);
  return items.slice(0, 20);
})()`);

console.log(JSON.stringify({ found, names }, null, 2));
page.close();
