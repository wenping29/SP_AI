const PORT = 9333;
const list = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const target = (await list()).find((x) => x.type === 'page' && /sidepanel\/sidepanel\.html(?!\?full=1)/.test(x.url || ''));
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) : r.result.value;
};
await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
const sample = [
  { modelId: 'm-smart', displayName: '智能旗舰', provider: 'deepseek', category: '最智能', inputRatePer1K: 4, outputRatePer1K: 16 },
  { modelId: 'm-cheap', displayName: '性价比一号', provider: 'zhipu', category: '高性价比', inputRatePer1K: 1, outputRatePer1K: 2 },
  { modelId: 'm-none', displayName: '未分类模型', provider: 'deepseek', category: '', inputRatePer1K: 2, outputRatePer1K: 6 },
  { modelId: 'm-adv', displayName: '高级模型', provider: 'dashscope', category: '高级', inputRatePer1K: 3, outputRatePer1K: 8 },
  { modelId: 'm-custom', displayName: '自定义分类模型', provider: 'qianfan', category: '实验分组', inputRatePer1K: 1, outputRatePer1K: 2 },
  { modelId: 'm-cheap2', displayName: '性价比二号', provider: 'deepseek', category: '高性价比', inputRatePer1K: 2, outputRatePer1K: 6 },
];
const r = await ev(`(() => {
  state.config = { ...(state.config || {}), models: ${JSON.stringify(sample)} };
  state.model = 'm-adv';
  renderModels();
  openModelMenu();
  const m = els.modelMenu;
  const last = m.lastElementChild.getBoundingClientRect();
  const box = m.getBoundingClientRect();
  return {
    clientH: m.clientHeight, scrollH: m.scrollHeight, maxH: getComputedStyle(m).maxHeight,
    box: { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right) },
    last: { top: Math.round(last.top), bottom: Math.round(last.bottom), visible: last.bottom <= box.bottom + 1 && last.top >= box.top - 1 },
    viewport: { w: innerWidth, h: innerHeight },
  };
})()`);
console.log(JSON.stringify(r, null, 2));
await ev('closeModelMenu(); location.reload();');
ws.close();
process.exit(0);
