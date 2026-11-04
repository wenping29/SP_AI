// 邮箱验证注册验证：设备 200 体验积分、验证码发送/限流/错误/次数、注册赠送、管理员创建与登录
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const BASE = "http://127.0.0.1:5099";
const ADMIN_KEY = "sp-test-admin-key-2026";
const out = { checks: [] };

function check(name, ok, detail) {
  out.checks.push({ name, ok: !!ok, detail });
  if (!ok) out.failed = (out.failed || 0) + 1;
}

async function api(path, { method = "GET", body, adminKey } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (adminKey) headers["X-Admin-Key"] = adminKey;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const stamp = Date.now();
const password = "SpMail@2026";
const deviceId = randomUUID();

// 1) 新设备给 200 匿名体验积分（不是注册赠送）
const anon = await api("/api/device/register", {
  method: "POST",
  body: { deviceId, label: "邮箱测试设备" },
});
check("新设备注册余额为 200", anon.status === 200 && anon.data?.balance === 200, anon.data);

// /api/credits 从 Bearer 取，匿名设备走 Account.Token
const creditsRes = await fetch(`${BASE}/api/credits`, {
  headers: { Authorization: `Bearer ${anon.data?.token}` },
});
const credits = await creditsRes.json();
check("新设备记体验流水且没有注册赠送", creditsRes.status === 200 && credits.balance === 200 &&
  (credits.transactions || []).some((t) => t.reason === "device_trial" && t.delta === 200) &&
  !(credits.transactions || []).some((t) => t.reason === "free_grant"), credits);

async function sendCode(email) {
  return api("/api/auth/email-code", { method: "POST", body: { email } });
}

async function register(email, code) {
  return api("/api/auth/register", {
    method: "POST",
    body: { email, password, displayName: "邮箱用户", deviceId, label: "邮箱测试设备", code },
  });
}

// 2) 发送验证码（开发模式返回 devCode）
const email1 = `mail-a-${stamp}@example.com`;
const code1 = await sendCode(email1);
check("发送验证码", code1.status === 200 && /^\d{6}$/.test(code1.data?.devCode || "") &&
  code1.data?.expiresIn > 0, { status: code1.status, data: code1.data });

const again = await sendCode(email1);
check("60 秒内重复发送被限流", again.status === 429 && again.data?.code === "code_too_frequent",
  { status: again.status, code: again.data?.code });

// 3) 错误验证码 / 缺少验证码
const noCode = await register(`mail-nocode-${stamp}@example.com`, "");
check("缺少验证码被拒绝", noCode.status === 400 && noCode.data?.code === "code_required",
  { status: noCode.status, code: noCode.data?.code });

const wrongCode = code1.data.devCode === "000000" ? "111111" : "000000";
const bad = await register(email1, wrongCode);
check("错误验证码被拒绝", bad.status === 400 && bad.data?.code === "code_invalid",
  { status: bad.status, code: bad.data?.code });

// 4) 正确验证码注册，拿到 1000 赠送并合并本机 200 体验积分
const reg1 = await register(email1, code1.data.devCode);
check("邮箱验证注册成功", reg1.status === 200 && reg1.data?.user?.email === email1, reg1.data);
check("注册赠送 1000 并合并体验积分", reg1.data?.giftCredits === 1000 &&
  reg1.data?.mergedCredits === 200 && reg1.data?.balance === 1200,
  { gift: reg1.data?.giftCredits, merged: reg1.data?.mergedCredits, balance: reg1.data?.balance });
const regCredits = await (await fetch(`${BASE}/api/credits`, {
  headers: { Authorization: `Bearer ${reg1.data?.token}` },
})).json();
check("账号流水含体验积分合并", (regCredits.transactions || [])
  .some((t) => t.reason === "device_merge" && t.delta === 200), regCredits.transactions);

const login1 = await api("/api/auth/login", {
  method: "POST",
  body: { email: email1, password, deviceId, label: "邮箱测试设备" },
});
check("注册后可正常登录", login1.status === 200 && login1.data?.balance === 1200, login1.data);

// 5) 重复验证码与已注册邮箱
const reuse = await register(`mail-other-${stamp}@example.com`, code1.data.devCode);
check("验证码不能跨邮箱复用", reuse.status === 400 && reuse.data?.code === "code_invalid",
  { status: reuse.status, code: reuse.data?.code });

const registeredAgain = await sendCode(email1);
check("已注册邮箱不能再获取注册验证码", registeredAgain.status === 409 &&
  registeredAgain.data?.code === "email_exists", { status: registeredAgain.status });

// 6) 错误次数上限
const email3 = `mail-attempts-${stamp}@example.com`;
const code3 = await sendCode(email3);
let last;
for (let i = 0; i < 6; i++) last = await register(email3, "999999" === code3.data.devCode ? "888888" : "999999");
check("验证码错误次数超限后锁定", last.status === 400 && last.data?.code === "code_attempts",
  { status: last.status, code: last.data?.code });

// 7) 运营策略调整赠送额度
const policy = await api("/api/admin/policy", {
  method: "PUT",
  adminKey: ADMIN_KEY,
  body: { freeCredits: 50 },
});
check("管理员调整注册赠送额度", policy.status === 200 && policy.data?.freeCredits === 50, policy.data);

const email4 = `mail-gift-${stamp}@example.com`;
const code4 = await sendCode(email4);
const reg4 = await register(email4, code4.data.devCode);
check("按策略发放 50 积分", reg4.status === 200 && reg4.data?.giftCredits === 50 &&
  reg4.data?.balance === 50, { gift: reg4.data?.giftCredits, balance: reg4.data?.balance });

await api("/api/admin/policy", { method: "PUT", adminKey: ADMIN_KEY, body: { freeCredits: 1000 } });

// 8) 管理员直接创建的用户不需要验证码，可直接登录
const email5 = `mail-admin-${stamp}@example.com`;
const created = await api("/api/admin/members", {
  method: "POST",
  adminKey: ADMIN_KEY,
  body: { email: email5, displayName: "后台创建用户", password: "AdminMade@2026" },
});
check("管理员可创建用户", created.status === 200 && created.data?.email === email5, created.data);

const adminLogin = await api("/api/auth/login", {
  method: "POST",
  body: { email: email5, password: "AdminMade@2026", deviceId: randomUUID(), label: "后台创建" },
});
check("管理员创建的用户可直接登录", adminLogin.status === 200 && !!adminLogin.data?.token,
  { status: adminLogin.status, code: adminLogin.data?.code });

out.summary = {
  total: out.checks.length,
  passed: out.checks.filter((c) => c.ok).length,
  failed: out.failed || 0,
};

await fs.writeFile("tests-web/email-api-report.json", JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed ? 1 : 0);
