// 积分按用户口径：设备页只显示绑定用户，积分管理按用户调分与流水
import fs from "node:fs/promises";

const BASE = "http://127.0.0.1:5098";
const ADMIN_KEY = "sp-test-admin-key-2026";

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ADMIN_KEY ? { "X-Admin-Key": ADMIN_KEY } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch { /* empty */ }
  return { status: res.status, data };
}

const stamp = Date.now();
const email = `usercred-${stamp}@example.com`;
const password = "UserCred@2026";
const deviceId = `usercred-${stamp}`;

const config = await api("/api/config");
const freeCredits = config.data?.freeCredits ?? 0;

const code = await api("/api/auth/email-code", { method: "POST", body: { email } });
const reg = await api("/api/auth/register", {
  method: "POST",
  body: { email, password, displayName: "积分用户测试", deviceId, label: "积分测试设备", code: code.data?.devCode },
});
const token = reg.data?.token;

const devicePage = await api(`/api/admin/devices?q=${encodeURIComponent(deviceId)}`);
const deviceRow = devicePage.data?.items?.[0];

const memberPage = await api(`/api/admin/members?q=${encodeURIComponent(email)}`);
const member = memberPage.data?.items?.[0];
const accountDeviceId = member?.accountDeviceId;

const summaryBefore = await api("/api/admin/credits/summary");

const grant = await api("/api/admin/credits/adjust", {
  method: "POST",
  body: { deviceId: accountDeviceId, delta: 500, reason: "test_adjust" },
});

const creditsAfterGrant = await api("/api/credits", { token });
const tx = await api(`/api/admin/devices/${encodeURIComponent(accountDeviceId)}/transactions`);
const summaryAfterGrant = await api("/api/admin/credits/summary");

const synthetic = await api(`/api/admin/devices?q=${encodeURIComponent(accountDeviceId)}`);

const setResult = await api("/api/admin/credits/adjust", {
  method: "POST",
  body: { deviceId: accountDeviceId, balance: 800, reason: "test_set" },
});
const summaryAfterSet = await api("/api/admin/credits/summary");

const logout = await api("/api/auth/logout", { method: "POST", token });
const afterLogout = await api(`/api/admin/devices?q=${encodeURIComponent(deviceId)}`);
const memberAfterLogout = await api(`/api/admin/members?q=${encodeURIComponent(email)}`);

// 设备运营角色（devices.*）也能使用按用户的积分管理；只读角色不能调分
async function userApi(path, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch { /* empty */ }
  return { status: res.status, data };
}

async function roleSession(name, permissions) {
  const role = await api("/api/admin/roles", {
    method: "POST",
    body: { name, description: "自动验证", permissions },
  });
  const username = `${name}-${stamp}`;
  const password = "RoleTest@2026";
  await api("/api/admin/users", {
    method: "POST",
    body: { username, displayName: name, roleId: role.data?.id, password },
  });
  const login = await userApi("/api/admin/auth/login", { method: "POST", body: { username, password } });
  return login.data?.token ?? "";
}

const opsToken = await roleSession("ops-test", ["dashboard.view", "devices.view", "devices.manage"]);
const opsMembers = await userApi(`/api/admin/members?q=${encodeURIComponent(email)}`, { token: opsToken });
const opsAdjust = await userApi("/api/admin/credits/adjust", {
  method: "POST",
  token: opsToken,
  body: { deviceId: accountDeviceId, delta: 1, reason: "ops_test" },
});
const readonlyToken = await roleSession("readonly-test", ["dashboard.view", "devices.view"]);
const readonlyMembers = await userApi(`/api/admin/members?q=${encodeURIComponent(email)}`, { token: readonlyToken });
const readonlyAdjust = await userApi("/api/admin/credits/adjust", {
  method: "POST",
  token: readonlyToken,
  body: { deviceId: accountDeviceId, delta: 1, reason: "readonly_test" },
});

const checks = {
  codeSent: code.status === 200 && !!code.data?.devCode,
  registerGift: reg.status === 200 && reg.data?.balance === freeCredits,
  deviceShowsBoundUser:
    deviceRow?.loggedIn === true && deviceRow?.accountEmail === email,
  deviceHasNoCreditFields:
    deviceRow && !("balance" in deviceRow) && !("spent" in deviceRow) &&
    !("calls" in deviceRow) && !("accountDeviceId" in deviceRow),
  userAccountHiddenFromDevices: synthetic.status === 200 && synthetic.data?.total === 0,
  memberHasCreditFields:
    member?.balance === freeCredits && member?.spent === 0 && member?.calls === 0 &&
    typeof member?.accountDeviceId === "string" && member.accountDeviceId.length > 0,
  summaryIsUserScoped:
    summaryBefore.data?.users === 1 && summaryBefore.data?.accounts === undefined &&
    summaryBefore.data?.totalBalance === freeCredits,
  grantAppliedToUser: grant.status === 200 && grant.data?.balance === freeCredits + 500,
  tokenSeesUserBalance: creditsAfterGrant.data?.balance === freeCredits + 500,
  flowUsesUserAccount:
    tx.data?.balance === freeCredits + 500 &&
    (tx.data?.items || []).some((t) => t.reason === "test_adjust" && t.delta === 500),
  manualAdjustNotConsumption:
    summaryAfterGrant.data?.spent === 0 && summaryAfterGrant.data?.calls === 0,
  setBalanceWorks:
    setResult.status === 200 && setResult.data?.balance === 800 &&
    setResult.data?.delta === 800 - (freeCredits + 500),
  summaryFollowsUserBalance: summaryAfterSet.data?.totalBalance === 800,
  logoutUnbindsDevice:
    logout.status === 200 && afterLogout.data?.items?.[0]?.loggedIn === false &&
    afterLogout.data?.items?.[0]?.accountEmail === "",
  userKeepsBalanceAfterLogout: memberAfterLogout.data?.items?.[0]?.balance === 800,
  opsRoleCanListUsers: opsMembers.status === 200 && opsMembers.data?.items?.[0]?.email === email,
  opsRoleCanAdjust: opsAdjust.status === 200 && opsAdjust.data?.balance === 801,
  readonlyRoleCanListUsers: readonlyMembers.status === 200,
  readonlyRoleCannotAdjust: readonlyAdjust.status === 403,
};

const out = {
  checks,
  sample: {
    deviceRow,
    member,
    summaryBefore: summaryBefore.data,
    grant: grant.data,
    summaryAfterSet: summaryAfterSet.data,
  },
  allPassed: Object.values(checks).every(Boolean),
};
await fs.writeFile(new URL("./device-balance-api-report.json", import.meta.url),
  JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ checks, sample: out.sample, allPassed: out.allPassed }, null, 2));
process.exit(out.allPassed ? 0 : 1);
