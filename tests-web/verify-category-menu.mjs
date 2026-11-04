const PORT = 9333;
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = (await list()).find(
  (x) => x.type === 'page' && /sidepanel\/sidepanel\.html(?!\?full=1)/.test(x.url || ''),
);
if (!target) {
  console.log('no sidepanel target');
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
};
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
await send('Page.reload', { ignoreCache: true });
for (let i = 0; i < 40; i++) {
  await sleep(250);
  if ((await ev('typeof renderModels === "function" && !!state.config')) === true) break;
}

const sample = [
  { modelId: 'm-smart', displayName: '智能旗舰', provider: 'deepseek', category: '最智能', inputRatePer1K: 4, outputRatePer1K: 16 },
  { modelId: 'm-cheap', displayName: '性价比一号', provider: 'zhipu', category: '高性价比', inputRatePer1K: 1, outputRatePer1K: 2 },
  { modelId: 'm-none', displayName: '未分类模型', provider: 'deepseek', category: '', inputRatePer1K: 2, outputRatePer1K: 6 },
  { modelId: 'm-adv', displayName: '高级模型', provider: 'dashscope', category: '高级', inputRatePer1K: 3, outputRatePer1K: 8 },
  { modelId: 'm-custom', displayName: '自定义分类模型', provider: 'qianfan', category: '实验分组', inputRatePer1K: 1, outputRatePer1K: 2 },
  { modelId: 'm-cheap2', displayName: '性价比二号', provider: 'deepseek', category: '高性价比', inputRatePer1K: 2, outputRatePer1K: 6 },
];

const result = await ev(`(() => {
  const sample = ${JSON.stringify(sample)};
  state.config = { ...(state.config || {}), models: sample };
  state.model = 'm-adv';
  renderModels();
  openModelMenu();
  const children = [...els.modelMenu.children].map((el) =>
    el.classList.contains('model-group') ? '#' + el.textContent : el.dataset.model + ':' + el.getAttribute('aria-selected'),
  );
  const headers = [...els.modelMenu.querySelectorAll('.model-group')];
  const style = headers[0] ? getComputedStyle(headers[0]) : null;
  const secondDivider = headers[1] ? getComputedStyle(headers[1]).borderTopWidth : null;
  const menu = els.modelMenu;
  return {
    expanded: els.modelButton.getAttribute('aria-expanded'),
    open: !menu.hidden,
    children,
    headerStyles: style ? { color: style.color, fontSize: style.fontSize, weight: style.fontWeight } : null,
    secondDivider,
    scrollable: menu.scrollHeight <= menu.clientHeight + 1,
    selectedVisible: (() => {
      const opt = menu.querySelector('[aria-selected="true"]');
      if (!opt) return false;
      const a = opt.getBoundingClientRect();
      const b = menu.getBoundingClientRect();
      return a.top >= b.top && a.bottom <= b.bottom;
    })(),
    tip: els.modelButton.dataset.tip,
  };
})()`);
console.log(JSON.stringify(result, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot?.data) {
  const fs = await import('node:fs');
  fs.writeFileSync('tests-web/cat-menu.png', Buffer.from(shot.data, 'base64'));
  console.log('saved tests-web/cat-menu.png');
}

await ev('closeModelMenu(); location.reload();');
ws.close();
process.exit(0);
