const B = 'http://127.0.0.1:5099/api';
const H = { 'X-Admin-Key': 'sp-test-admin-key-2026', 'Content-Type': 'application/json' };
const j = (r) => r.json();

const models = await j(await fetch(B + '/admin/models', { headers: H }));
console.log('admin models:', models.length, 'cats:', [...new Set(models.map((m) => m.category))]);

const created = await j(await fetch(B + '/admin/models', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    modelId: 'cat-test-model',
    displayName: '分类测试模型',
    provider: 'deepseek',
    upstreamModel: 'deepseek-chat',
    inputRatePer1K: 2,
    outputRatePer1K: 6,
    category: '自定义分类',
    isEnabled: true,
  }),
}));
console.log('created:', created.modelId, created.category);

const updated = await j(await fetch(B + '/admin/models/cat-test-model', {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ category: '高级' }),
}));
console.log('updated to:', updated.category);

const cfg = await j(await fetch(B + '/config'));
console.log('config delivered:', cfg.models.map((m) => [m.modelId, m.category]));

const clamped = await j(await fetch(B + '/admin/models/cat-test-model', {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ category: '一二三四五六七八九十一二三四五六七八九十一二三四五' }),
}));
console.log('clamped:', clamped.category, clamped.category.length);

const del = await j(await fetch(B + '/admin/models/cat-test-model', { method: 'DELETE', headers: H }));
console.log('deleted:', del);

await fetch(B + '/admin/models/glm-4-flash', {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ category: '自定义保留' }),
});
console.log('set glm-4-flash category to 自定义保留 (restart check next)');
