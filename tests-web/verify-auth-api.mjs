// 账号体系接口验证：注册合并、多设备共享、退出回落、错误分支
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const BASE = "http://127.0.0.1:5099";
const out = { steps: [] };

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const email = `sp-test-${Date.now()}@example.com`;
const password = "SpTest@2026";
const d1 = randomUUID();
const d2 = randomUUID();

// 1) 设备匿名注册
const anon1 = await api("/api/device/register", {
  method: "POST",
  body: { deviceId: d1, label: "测试设备一" },
});
out.anon1 = anon1;

// 2) 邮箱验证码注册（本机 200 体验积分，与注册赠送合并进账号）
const emailCode = await api("/api/auth/email-code", { method: "POST", body: { email } });
out.emailCode = emailCode;
const reg = await api("/api/auth/register", {
  method: "POST",
  body: {
    email,
    password,
    displayName: "测试用户",
    deviceId: d1,
    label: "测试设备一",
    code: emailCode.data?.devCode,
  },
});
out.register = reg;

// 3) me（登录态）
out.meLoggedIn = await api("/api/auth/me", { token: reg.data?.token });

// 4) 积分接口用登录令牌
out.creditsUser = await api("/api/credits", { token: reg.data?.token });

// 5) 第二台设备：先匿名注册，再登录同一账号
const anon2 = await api("/api/device/register", {
  method: "POST",
  body: { deviceId: d2, label: "测试设备二" },
});
out.anon2 = anon2;
const login2 = await api("/api/auth/login", {
  method: "POST",
  body: { email, password, deviceId: d2, label: "测试设备二" },
});
out.login2 = login2;

// 6) 第一台设备的令牌应看到共享后的余额
out.creditsDevice1 = await api("/api/credits", { token: reg.data?.token });

// 7) 第二台设备退出 → 回落到本机匿名账号
const logout2 = await api("/api/auth/logout", { method: "POST", token: login2.data?.token });
out.logout2 = logout2;
out.meAfterLogout = await api("/api/auth/me", { token: logout2.data?.token });
out.creditsAfterLogout = await api("/api/credits", { token: logout2.data?.token });

// 8) 第一台设备仍保持登录
out.meDevice1StillIn = await api("/api/auth/me", { token: reg.data?.token });

// 9) 错误分支
out.wrongPassword = await api("/api/auth/login", {
  method: "POST",
  body: { email, password: "wrong-password", deviceId: d1 },
});
out.duplicateEmail = await api("/api/auth/register", {
  method: "POST",
  body: { email, password, deviceId: d1 },
});
out.badEmail = await api("/api/auth/register", {
  method: "POST",
  body: { email: "not-an-email", password, deviceId: d1 },
});
out.shortPassword = await api("/api/auth/register", {
  method: "POST",
  body: { email: `x-${Date.now()}@example.com`, password: "123", deviceId: d1 },
});
out.missingCode = await api("/api/auth/register", {
  method: "POST",
  body: { email: `nocode-${Date.now()}@example.com`, password, deviceId: d1 },
});

const ok = {
  anonBalance: anon1.data?.balance === 200,
  anon2Balance: anon2.data?.balance === 200,
  codeSent: emailCode.status === 200 && /^\d{6}$/.test(emailCode.data?.devCode || ""),
  registerGift: reg.status === 200 && reg.data?.giftCredits === 1000 &&
    reg.data?.mergedCredits === 200 && reg.data?.balance === 1200,
  accountIdSynthetic: /^u[0-9a-f]{32}$/.test(reg.data?.accountDeviceId || ""),
  meLoggedIn: out.meLoggedIn.data?.loggedIn === true && out.meLoggedIn.data?.email === email,
  creditsShared: out.creditsUser.data?.balance === 1200,
  login2Merged: login2.data?.mergedCredits === 200 && login2.data?.balance === 1400,
  device1SeesShared: out.creditsDevice1.data?.balance === 1400,
  logoutAnon: logout2.status === 200 && logout2.data?.balance === 0 &&
    logout2.data?.accountDeviceId === d2,
  meAfterLogout: out.meAfterLogout.data?.loggedIn === false,
  anonTokenWorks: out.creditsAfterLogout.data?.balance === 0,
  device1StillIn: out.meDevice1StillIn.data?.loggedIn === true,
  wrongPassword401: out.wrongPassword.status === 401,
  duplicate409: out.duplicateEmail.status === 409,
  badEmail400: out.badEmail.status === 400,
  shortPassword400: out.shortPassword.status === 400,
  missingCode400: out.missingCode.status === 400 && out.missingCode.data?.code === "code_required",
};
out.checks = ok;
out.allPassed = Object.values(ok).every(Boolean);

await fs.writeFile("auth-api-report.json", JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify({ checks: ok, allPassed: out.allPassed }, null, 2));
process.exit(0);
