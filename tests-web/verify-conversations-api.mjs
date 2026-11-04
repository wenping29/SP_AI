// 聊天记录同步接口验证：登录上传、跨设备拉取、账号隔离、匿名拒绝、更新与删除
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

const BASE = "http://127.0.0.1:5099";
const out = { steps: [], checks: [] };

function check(name, ok, detail) {
  out.checks.push({ name, ok: !!ok, detail });
  if (!ok) out.failed = (out.failed || 0) + 1;
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const stamp = Date.now();
const emailA = `conv-a-${stamp}@example.com`;
const emailB = `conv-b-${stamp}@example.com`;
const password = "SpConv@2026";
const dA = randomUUID();
const dB = randomUUID();
const dC = randomUUID();
const clientId = randomUUID();

// 设备 A 注册账号
const anonA = await api("/api/device/register", { method: "POST", body: { deviceId: dA, label: "设备 A" } });
const codeA = await api("/api/auth/email-code", { method: "POST", body: { email: emailA } });
const regA = await api("/api/auth/register", {
  method: "POST",
  body: {
    email: emailA,
    password,
    displayName: "记录用户 A",
    deviceId: dA,
    label: "设备 A",
    code: codeA.data?.devCode,
  },
});
const tokenA = regA.data?.token;
check("设备 A 注册账号", regA.status === 200 && !!tokenA, { status: regA.status });

const anonList = await api("/api/conversations", { token: anonA.data?.token });
check("匿名设备禁止同步", anonList.status === 403 && anonList.data?.code === "login_required",
  { status: anonList.status, code: anonList.data?.code });

// 空列表
const empty = await api("/api/conversations", { token: tokenA });
check("新账号列表为空", empty.status === 200 && Array.isArray(empty.data) && empty.data.length === 0,
  empty.data);

// 上传一段会话
const t1 = Date.now();
const messages1 = [
  { role: "user", content: "你好", at: t1 - 2000 },
  { role: "assistant", content: "你好，有什么可以帮你？", at: t1 - 1000 },
];
const put1 = await api(`/api/conversations/${clientId}`, {
  method: "PUT",
  token: tokenA,
  body: { title: "第一段对话", updatedAt: t1, messages: messages1 },
});
check("上传会话", put1.status === 200 && put1.data?.title === "第一段对话", put1.data);

// 列表摘要
const listA = await api("/api/conversations", { token: tokenA });
const summary = listA.data?.[0];
check("列表含摘要与条数", listA.data?.length === 1 && summary?.messageCount === 2,
  { count: listA.data?.length, summary });
check("摘要返回 clientUpdatedAt", summary?.clientUpdatedAt === t1, summary?.clientUpdatedAt);

// 单条详情
const getA = await api(`/api/conversations/${clientId}`, { token: tokenA });
check("详情消息完整", getA.status === 200 && getA.data?.messages?.length === 2 &&
  getA.data.messages[1].content.includes("有什么可以帮你"), getA.data?.messages);

// 设备 B 登录同一账号 → 能拉到
await api("/api/device/register", { method: "POST", body: { deviceId: dB, label: "设备 B" } });
const loginB = await api("/api/auth/login", {
  method: "POST",
  body: { email: emailA, password, deviceId: dB, label: "设备 B" },
});
const tokenB = loginB.data?.token;
const listB = await api("/api/conversations", { token: tokenB });
const getB = await api(`/api/conversations/${clientId}`, { token: tokenB });
check("另一台设备登录后可恢复列表", listB.status === 200 && listB.data?.length === 1, listB.data);
check("另一台设备可恢复正文", getB.data?.messages?.length === 2, getB.data?.messages?.length);

// 设备 B 更新会话
const t2 = t1 + 60_000;
const put2 = await api(`/api/conversations/${clientId}`, {
  method: "PUT",
  token: tokenB,
  body: { title: "第一段对话（续）", updatedAt: t2, messages: [...messages1, { role: "user", content: "继续" }] },
});
check("另一台设备可更新会话", put2.status === 200 && put2.data?.messages?.length === 3,
  { status: put2.status, count: put2.data?.messages?.length });
const listA2 = await api("/api/conversations", { token: tokenA });
check("更新后设备 A 看到新版本", listA2.data?.[0]?.title === "第一段对话（续）" &&
  listA2.data[0].clientUpdatedAt === t2, listA2.data?.[0]);

// 账号 B 隔离
await api("/api/device/register", { method: "POST", body: { deviceId: dC, label: "设备 C" } });
const codeB = await api("/api/auth/email-code", { method: "POST", body: { email: emailB } });
const regB = await api("/api/auth/register", {
  method: "POST",
  body: {
    email: emailB,
    password,
    displayName: "记录用户 B",
    deviceId: dC,
    label: "设备 C",
    code: codeB.data?.devCode,
  },
});
const tokenBUser = regB.data?.token;
const listOther = await api("/api/conversations", { token: tokenBUser });
const getOther = await api(`/api/conversations/${clientId}`, { token: tokenBUser });
check("另一账号列表看不到", listOther.status === 200 && listOther.data?.length === 0, listOther.data);
check("另一账号取详情返回 404", getOther.status === 404 && getOther.data?.code === "conversation_not_found",
  { status: getOther.status, code: getOther.data?.code });
const deleteOther = await api(`/api/conversations/${clientId}`, { method: "DELETE", token: tokenBUser });
check("另一账号删除不影响原记录", deleteOther.status === 200 && deleteOther.data?.deleted === false,
  deleteOther.data);

// 非法 ID / 超量 / 超大
const badId = await api("/api/conversations/abc", {
  method: "PUT", token: tokenA, body: { title: "x", updatedAt: Date.now(), messages: [] },
});
check("非法会话 ID 返回 400", badId.status === 400 && badId.data?.code === "invalid_client_id",
  { status: badId.status, code: badId.data?.code });

const tooMany = await api(`/api/conversations/${randomUUID()}`, {
  method: "PUT", token: tokenA,
  body: { title: "x", updatedAt: Date.now(), messages: Array.from({ length: 201 }, () => ({ role: "user", content: "a" })) },
});
check("超过消息条数返回 400", tooMany.status === 400 && tooMany.data?.code === "too_many_messages",
  { status: tooMany.status, code: tooMany.data?.code });

const huge = await api(`/api/conversations/${randomUUID()}`, {
  method: "PUT", token: tokenA,
  body: { title: "x", updatedAt: Date.now(), messages: [{ role: "user", content: "x".repeat(1_050_000) }] },
});
check("超大内容返回 413", huge.status === 413 && huge.data?.code === "payload_too_large",
  { status: huge.status, code: huge.data?.code });

// 删除
const del = await api(`/api/conversations/${clientId}`, { method: "DELETE", token: tokenA });
const afterDel = await api("/api/conversations", { token: tokenA });
const getDel = await api(`/api/conversations/${clientId}`, { token: tokenA });
check("删除会话", del.status === 200 && del.data?.deleted === true, del.data);
check("删除后列表为空", afterDel.data?.length === 0, afterDel.data);
check("删除后详情 404", getDel.status === 404, getDel.status);

// 服务器时间兜底：updatedAt 缺失时也能写入
const fallbackId = randomUUID();
const noAt = await api(`/api/conversations/${fallbackId}`, {
  method: "PUT", token: tokenA,
  body: { title: "", updatedAt: null, messages: [{ role: "user", content: "hi" }] },
});
check("缺少 updatedAt 时用服务端时间并补标题", noAt.status === 200 && noAt.data?.title === "未命名聊天" &&
  noAt.data?.clientUpdatedAt > 0, noAt.data);

out.summary = {
  total: out.checks.length,
  passed: out.checks.filter((c) => c.ok).length,
  failed: out.failed || 0,
};

await fs.writeFile("tests-web/conversations-api-report.json", JSON.stringify(out, null, 2), "utf8");
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed ? 1 : 0);
