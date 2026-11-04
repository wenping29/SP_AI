const BASE = 'http://127.0.0.1:5099';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(path, { method = 'GET', token, adminKey, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Admin-Token'] = token;
  if (adminKey) headers['X-Admin-Key'] = adminKey;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

const auth = (token) => api('/api/auth/login', {
  method: 'POST',
  body: { email: token.email, password: token.password, deviceId: token.deviceId, label: 'verify' },
});

// 1. 超级管理员登录，权限应同时含 users.* 与 admins.*
const login = await api('/api/admin/auth/login', {
  method: 'POST',
  body: { username: 'root', password: 'Passw0rd!123' },
});
check('管理员登录', login.status === 200 && !!login.json?.token, JSON.stringify(login.json?.user?.permissions));
const root = login.json?.token;
const perms = login.json?.user?.permissions ?? [];
const granted = (p) => perms.includes('*') || perms.includes(p);
check('权限含 admins.view/manage', granted('admins.view') && granted('admins.manage'));
check('权限含 users.view/manage', granted('users.view') && granted('users.manage'));

// 2. 管理员表
const admins = await api('/api/admin/users', { token: root });
check('管理员列表', admins.status === 200 && admins.json.some((u) => u.username === 'root'),
  `共 ${admins.json?.length} 人`);

// 3. 用户表初始为空
const empty = await api('/api/admin/members?page=1&pageSize=10', { token: root });
check('用户列表初始为空', empty.status === 200 && empty.json.total === 0,
  `total=${empty.json?.total} page=${empty.json?.page} size=${empty.json?.pageSize}`);

// 4. 新增用户
const created = await api('/api/admin/members', {
  method: 'POST', token: root,
  body: { email: 'Member1@Example.com', displayName: '测试用户', password: 'Member#123' },
});
check('新增用户', created.status === 200 && created.json.email === 'member1@example.com',
  JSON.stringify(created.json));
const memberId = created.json?.id;

const dup = await api('/api/admin/members', {
  method: 'POST', token: root,
  body: { email: 'member1@example.com', password: 'Member#123' },
});
check('重复邮箱被拒', dup.status === 409 && dup.json?.code === 'email_exists');

const weak = await api('/api/admin/members', {
  method: 'POST', token: root,
  body: { email: 'weak@example.com', password: '123' },
});
check('弱密码被拒', weak.status === 400 && weak.json?.code === 'weak_password');

// 5. 搜索
const search = await api('/api/admin/members?q=member1&page=1&pageSize=10', { token: root });
check('搜索用户', search.status === 200 && search.json.total === 1 && search.json.items[0].id === memberId);

// 6. 编辑资料与重置密码
const updated = await api(`/api/admin/members/${memberId}`, {
  method: 'PUT', token: root,
  body: { email: 'member2@example.com', displayName: '改名用户', password: 'NewPass#123' },
});
check('编辑用户', updated.status === 200 && updated.json.email === 'member2@example.com'
  && updated.json.displayName === '改名用户');

// 7. 用户可用新密码登录插件
const userLogin = await api('/api/auth/login', {
  method: 'POST',
  body: { email: 'member2@example.com', password: 'NewPass#123', deviceId: 'verifydevice0001', label: '验证设备' },
});
check('用户新密码登录', userLogin.status === 200 && !!userLogin.json?.token,
  `accountDeviceId=${userLogin.json?.accountDeviceId}`);
const userToken = userLogin.json?.token;

const me = await fetch(BASE + '/api/auth/me', { headers: { Authorization: `Bearer ${userToken}` } });
check('用户 /me', me.status === 200);

// 用户列表中应显示 1 台设备
const withDevice = await api(`/api/admin/members?q=member2&page=1&pageSize=10`, { token: root });
check('用户设备数统计', withDevice.json?.items?.[0]?.deviceCount === 1,
  `deviceCount=${withDevice.json?.items?.[0]?.deviceCount}`);

// 8. 封禁：用户无法登录，已有令牌调用被拒
const blocked = await api(`/api/admin/members/${memberId}/block`, {
  method: 'POST', token: root, body: { blocked: true },
});
check('封禁用户', blocked.status === 200 && blocked.json.isBlocked === true);

const loginBlocked = await api('/api/auth/login', {
  method: 'POST',
  body: { email: 'member2@example.com', password: 'NewPass#123', deviceId: 'verifydevice0001' },
});
check('封禁后登录被拒', loginBlocked.status === 401);

const creditsBlocked = await fetch(BASE + '/api/credits', { headers: { Authorization: `Bearer ${userToken}` } });
check('封禁后旧令牌调用被拒', creditsBlocked.status === 403);

// 9. 解封
const unblocked = await api(`/api/admin/members/${memberId}/block`, {
  method: 'POST', token: root, body: { blocked: false },
});
check('解封用户', unblocked.status === 200 && unblocked.json.isBlocked === false);

const loginAgain = await api('/api/auth/login', {
  method: 'POST',
  body: { email: 'member2@example.com', password: 'NewPass#123', deviceId: 'verifydevice0001' },
});
check('解封后可登录', loginAgain.status === 200);
const activeToken = loginAgain.json?.token;

// 10. 权限分表：只有 users.view 的角色看不到管理员表
const roleUsers = await api('/api/admin/roles', {
  method: 'POST', token: root,
  body: { name: '仅用户查看', description: '测试', permissions: ['users.view'] },
});
const roleUsersId = roleUsers.json?.id;
const adminUsersOnly = await api('/api/admin/users', {
  method: 'POST', token: root,
  body: { username: 'uviewer', displayName: '用户查看员', roleId: roleUsersId, password: 'Viewer#123' },
});
const loginUViewer = await api('/api/admin/auth/login', {
  method: 'POST', body: { username: 'uviewer', password: 'Viewer#123' },
});
check('仅 users.view 可查看用户表', (await api('/api/admin/members', { token: loginUViewer.json?.token })).status === 200);
check('仅 users.view 不能查看管理员表', (await api('/api/admin/users', { token: loginUViewer.json?.token })).status === 403);
check('仅 users.view 不能新增用户', (await api('/api/admin/members', {
  method: 'POST', token: loginUViewer.json?.token,
  body: { email: 'x@example.com', password: 'Xxxxxxxx#1' },
})).status === 403);

// 11. 只有 admins.view 的角色相反
const roleAdmins = await api('/api/admin/roles', {
  method: 'POST', token: root,
  body: { name: '仅管理员查看', description: '测试', permissions: ['admins.view'] },
});
const adminAdmin = await api('/api/admin/users', {
  method: 'POST', token: root,
  body: { username: 'aviewer', displayName: '管理员查看员', roleId: roleAdmins.json?.id, password: 'Viewer#123' },
});
const loginAViewer = await api('/api/admin/auth/login', {
  method: 'POST', body: { username: 'aviewer', password: 'Viewer#123' },
});
check('仅 admins.view 可查看管理员表', (await api('/api/admin/users', { token: loginAViewer.json?.token })).status === 200);
check('仅 admins.view 不能查看用户表', (await api('/api/admin/members', { token: loginAViewer.json?.token })).status === 403);

// 清理测试管理员与角色
await api(`/api/admin/users/${adminUsersOnly.json?.id}`, { method: 'DELETE', token: root });
await api(`/api/admin/users/${adminAdmin.json?.id}`, { method: 'DELETE', token: root });
await api(`/api/admin/roles/${roleUsersId}`, { method: 'DELETE', token: root });
await api(`/api/admin/roles/${roleAdmins.json?.id}`, { method: 'DELETE', token: root });

// 12. 删除用户：列表清空，登录失效，原设备令牌回落匿名账号
const removed = await api(`/api/admin/members/${memberId}`, { method: 'DELETE', token: root });
check('删除用户', removed.status === 200 && removed.json.deleted === true);

const afterDelete = await api('/api/admin/members?q=member2&page=1&pageSize=10', { token: root });
check('删除后列表为空', afterDelete.status === 200 && afterDelete.json.total === 0);

const loginDeleted = await api('/api/auth/login', {
  method: 'POST',
  body: { email: 'member2@example.com', password: 'NewPass#123', deviceId: 'verifydevice0001' },
});
check('删除后登录失败', loginDeleted.status === 401);

const anonCredits = await fetch(BASE + '/api/credits', { headers: { Authorization: `Bearer ${activeToken}` } });
const anonJson = anonCredits.status === 200 ? await anonCredits.json() : null;
check('删除后设备回落匿名账号', anonCredits.status === 200 && anonJson?.balance === 0,
  anonJson ? `balance=${anonJson.balance} device=${anonJson.deviceId}` : `status=${anonCredits.status}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
