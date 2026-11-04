// 设备管理：登录后展示账号余额，调分落到账号
import fs from "node:fs/promises";

const BASE = "http://127.0.0.1:5098";
const cfg = JSON.parse(await fs.readFile(new URL("../server/appsettings.json", import.meta.url), "utf8"));
const ADMIN_KEY = cfg.Admin.Key;

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

const email = `devbal-${Date.now()}@example.com`;
const password = "DevBal@2026";
const deviceId = `devbal-${Date.now()}`;

const out = {};
const code = await api("/api/auth/email-code", { method: "POST", body: { email } });
out.codeSent = code.status === 200 && !!code.data?.devCode;

const reg = await api("/api/auth/register", {
  method: "POST",
  body: { email, password, displayName: "设备余额测试", deviceId, label: "余额测试设备", code: code.data?.devCode },
});
out.register = { status: reg.status, balance: reg.data?.balance, gift: reg.data?.giftCredits };
const token = reg.data?.token;

const devicePage = await api(`/api/admin/devices?scope=device&q=${encodeURIComponent(deviceId)}`);
const row = devicePage.data?.items?.[0];
const accountDeviceId = row?.accountDeviceId;

const adjust = await api("/api/admin/grant", {
  method: "POST",
  body: { deviceId: accountDeviceId, delta: 500, reason: "test_grant" },
});

const credits = await api("/api/credits", { token });
const tx = await api(`/api/admin/devices/${encodeURIComponent(accountDeviceId)}/transactions`);
const allPage = await api(`/api/admin/devices?q=${encodeURIComponent(deviceId)}&pageSize=50`);
const anonRow = (allPage.data?.items || []).find((x) => x.deviceId === deviceId);
const userRow = (allPage.data?.items || []).find((x) => x.deviceId === accountDeviceId);

const logout = await api("/api/auth/logout", { method: "POST", token });
const afterLogout = await api(`/api/admin/devices?scope=device&q=${encodeURIComponent(deviceId)}`);

const checks = {
  codeSent: out.codeSent,
  gift1000: reg.status === 200 && reg.data?.balance === 1000,
  deviceShowsAccountBalance: row?.balance === 1000,
  deviceMarkedLoggedIn: row?.loggedIn === true && row?.accountEmail === email,
  syntheticRowHidden: !devicePage.data?.items?.some((x) => x.deviceId !== deviceId),
  grantAppliedToAccount: adjust.status === 200 && adjust.data?.balance === 1500,
  accountBalanceAfterGrant: credits.data?.balance === 1500,
  transactionUsesAccount: tx.data?.balance === 1500 &&
    (tx.data?.items || []).some((t) => t.reason === "test_grant" && t.delta === 500),
  accountsPageStaysRaw: anonRow?.balance === 0 && userRow?.balance === 1500,
  logoutFallsBack: logout.status === 200 &&
    afterLogout.data?.items?.[0]?.loggedIn === false &&
    afterLogout.data?.items?.[0]?.balance === 0,
};

out.checks = checks;
out.sample = { row, adjust: adjust.data, anonRow, userRow };
out.allPassed = Object.values(checks).every(Boolean);
await fs.writeFile(new URL("./device-balance-api-report.json", import.meta.url), JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ checks, sample: out.sample, allPassed: out.allPassed }, null, 2));
process.exit(out.allPassed ? 0 : 1);
