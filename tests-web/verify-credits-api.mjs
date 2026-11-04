const B = 'http://127.0.0.1:5099/api';
const H = { 'X-Admin-Key': 'sp-test-admin-key-2026', 'Content-Type': 'application/json' };
const DEVICE = 'device-test-0001';
const j = async (r) => ({ status: r.status, body: await r.json() });
const post = (path, body) => fetch(B + path, { method: 'POST', headers: H, body: JSON.stringify(body) }).then(j);
const get = (path) => fetch(B + path, { headers: H }).then(j);

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail ?? ''); }
};

const before = await get(`/admin/devices?q=${DEVICE}&page=1&pageSize=10`);
const start = before.body.items[0];
console.log('start balance', start.balance, 'spent', start.spent, 'calls', start.calls);
const summaryBefore = (await get('/admin/credits/summary')).body;
console.log('summary before', summaryBefore);

const add = await post('/admin/credits/adjust', { deviceId: DEVICE, delta: 100 });
check('增加 100', add.status === 200 && add.body.balance === start.balance + 100, add);

const set = await post('/admin/credits/adjust', { deviceId: DEVICE, balance: 500 });
check('设为 500', set.status === 200 && set.body.balance === 500 && set.body.delta === 500 - (start.balance + 100), set);

const overdraft = await post('/admin/credits/adjust', { deviceId: DEVICE, delta: -999999 });
check('扣减超余额被拒', overdraft.status === 400 && overdraft.body.code === 'balance_below_zero', overdraft);

const zero = await post('/admin/credits/adjust', { deviceId: DEVICE, balance: 0 });
check('设为 0', zero.status === 200 && zero.body.balance === 0, zero);

const back = await post('/admin/credits/adjust', { deviceId: DEVICE, delta: start.balance, reason: '活动补发' });
check('补回原余额', back.status === 200 && back.body.balance === start.balance, back);

const neither = await post('/admin/credits/adjust', { deviceId: DEVICE });
check('缺少 delta/balance 被拒', neither.status === 400 && neither.body.code === 'invalid_adjust', neither);

const both = await post('/admin/credits/adjust', { deviceId: DEVICE, delta: 1, balance: 1 });
check('同时传 delta/balance 被拒', both.status === 400 && both.body.code === 'invalid_adjust', both);

const unknown = await post('/admin/credits/adjust', { deviceId: 'no-such-device', delta: 1 });
check('未知用户 404', unknown.status === 404 && unknown.body.code === 'account_not_found', unknown);

const negative = await post('/admin/credits/adjust', { deviceId: DEVICE, balance: -5 });
check('目标余额为负被拒', negative.status === 400 && negative.body.code === 'invalid_balance', negative);

const after = await get(`/admin/devices?q=${DEVICE}&page=1&pageSize=10`);
const row = after.body.items[0];
check('最终余额恢复', row.balance === start.balance, row.balance);
check('手工调整不影响累计消耗', row.spent === start.spent && row.calls === start.calls, row);

const ledger = await get(`/admin/devices/${DEVICE}/transactions?take=12`);
const reasons = ledger.body.items.slice(0, 6).map((t) => [t.reason, t.delta]);
console.log('latest ledger', reasons);
check('流水记录了 admin_set/admin_grant', reasons.some(([r]) => r === 'admin_set') && reasons.some(([r]) => r === 'admin_grant'), reasons);

const summaryAfter = (await get('/admin/credits/summary')).body;
check('总余额回到基线', summaryAfter.totalBalance === summaryBefore.totalBalance, summaryAfter);
check('累计消耗未受手工调整影响', summaryAfter.spent === summaryBefore.spent && summaryAfter.calls === summaryBefore.calls, summaryAfter);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
