const DEFAULT_SERVER = "http://127.0.0.1:5080";
const STORE_KEYS = ["server", "token", "deviceId", "label", "model", "sessions", "activeSession"];
const REASON_LABELS = {
  free_grant: "注册赠送",
  chat: "对话消耗",
  refund: "失败退款",
  voice: "语音输入",
  admin_grant: "后台调整",
};
const VIEW_TITLES = { chat: "聊天", ask: "提问", translate: "翻译", tools: "工具", settings: "设置" };
const QUICK_ASKS = [
  { text: "用三句话讲清楚这个页面在说什么", page: true },
  { text: "这个页面有哪些关键数据和结论？", page: true },
  { text: "这个产品或功能适合谁？值不值得试？", page: true },
  { text: "把这段内容改写得更简洁、更正式", page: false },
  { text: "解释其中的专业术语和缩写", page: false },
  { text: "列出这段文字里我需要自己核对的事实", page: false },
];
const HISTORY_TURNS = 6;
const MAX_SESSIONS = 30;
const MAX_ATTACH_CHARS = 4_000_000;
const MAX_TEXT_FILE_CHARS = 6000;

const els = {
  rail: document.getElementById("rail"),
  status: document.getElementById("status"),
  notice: document.getElementById("notice"),
  viewTitle: document.getElementById("viewTitle"),
  panelClose: document.getElementById("panelClose"),
  newChat: document.getElementById("newChat"),
  openHistory: document.getElementById("openHistory"),
  brandVersion: document.getElementById("brandVersion"),
  chatView: document.getElementById("chatView"),
  thread: document.getElementById("thread"),
  selectionCard: document.getElementById("selectionCard"),
  selectionText: document.getElementById("selectionText"),
  runSelection: document.getElementById("runSelection"),
  attachments: document.getElementById("attachments"),
  input: document.getElementById("input"),
  model: document.getElementById("model"),
  btnShot: document.getElementById("btnShot"),
  btnFile: document.getElementById("btnFile"),
  btnVoice: document.getElementById("btnVoice"),
  btnReadPage: document.getElementById("btnReadPage"),
  filePicker: document.getElementById("filePicker"),
  send: document.getElementById("send"),
  stop: document.getElementById("stop"),
  askView: document.getElementById("askView"),
  askList: document.getElementById("askList"),
  translateView: document.getElementById("translateView"),
  translateSource: document.getElementById("translateSource"),
  refreshSelection: document.getElementById("refreshSelection"),
  translateZh: document.getElementById("translateZh"),
  translateEn: document.getElementById("translateEn"),
  toolsView: document.getElementById("toolsView"),
  tools: document.getElementById("tools"),
  settingsView: document.getElementById("settingsView"),
  serverInput: document.getElementById("serverInput"),
  labelInput: document.getElementById("labelInput"),
  deviceInput: document.getElementById("deviceInput"),
  tokenInput: document.getElementById("tokenInput"),
  launcherToggle: document.getElementById("launcherToggle"),
  saveSettings: document.getElementById("saveSettings"),
  reregister: document.getElementById("reregister"),
  openCredits: document.getElementById("openCredits"),
  historyDialog: document.getElementById("historyDialog"),
  historyList: document.getElementById("historyList"),
  clearHistory: document.getElementById("clearHistory"),
  closeHistory: document.getElementById("closeHistory"),
  creditsDialog: document.getElementById("creditsDialog"),
  creditsBalance: document.getElementById("creditsBalance"),
  transactions: document.getElementById("transactions"),
  refreshCredits: document.getElementById("refreshCredits"),
  closeCredits: document.getElementById("closeCredits"),
  rechargeDevice: document.getElementById("rechargeDevice"),
  copyRechargeDevice: document.getElementById("copyRechargeDevice"),
  avatarDock: document.getElementById("avatarDock"),
  avatar: document.getElementById("avatar"),
  accountPop: document.getElementById("accountPop"),
  popDevice: document.getElementById("popDevice"),
  popStatus: document.getElementById("popStatus"),
  popCredits: document.getElementById("popCredits"),
  popBalance: document.getElementById("popBalance"),
  popRecharge: document.getElementById("popRecharge"),
  popVersion: document.getElementById("popVersion"),
};

const state = {
  server: DEFAULT_SERVER,
  token: "",
  deviceId: "",
  label: "",
  model: "",
  config: null,
  sessions: [],
  activeId: "",
  view: "chat",
  selection: "",
  attachments: [],
  readPage: false,
  pageCache: null,
  controller: null,
  voice: null,
  busy: false,
  balance: undefined,
  lastRequest: null,
};

class UiError extends Error {}

// ---------- 基础渲染 ----------

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status${kind ? ` ${kind}` : ""}`;
  // 顶部状态条搬进了头像浮层，两处保持同一份状态
  els.popStatus.textContent = text;
  els.popStatus.className = `pop-status${kind ? ` ${kind}` : ""}`;
}

function showError(err) {
  if (err instanceof TypeError) {
    setStatus(`连不上服务器：${state.server}`, "error");
    toast(`无法连接后端 ${state.server}，请在右侧「设置」里检查服务器地址。`);
    return;
  }
  setStatus(err.message || "出错了", "error");
  toast(err.message || "出错了");
}

function toast(text) {
  appendMessage("error", text);
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ---------- 图标：控件只显示图标，名称靠悬浮气泡 ----------

const ICONS = {
  chat: '<path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.5-.3-3.6-.9L4 21l1.4-4.9A8.5 8.5 0 1 1 21 12z"/>',
  sparkle: '<path d="M11 4l1.7 4.4L17 10l-4.3 1.6L11 16l-1.7-4.4L5 10l4.3-1.6z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  translate: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
  camera: '<path d="M4 8.5h2.6L8.4 6h7.2l1.8 2.5H20a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.2"/>',
  clip: '<path d="M20.5 11.5l-8.4 8.4a5 5 0 0 1-7-7l8.6-8.6a3.4 3.4 0 0 1 4.9 4.9L10 16.3a1.9 1.9 0 0 1-2.7-2.7l7.4-7.4"/>',
  mic: '<rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18.2V21.4"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  compose: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14.5 5.5l4 4"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><path d="M12 8.2V12l3 1.9"/>',
  send: '<path d="M21.5 2.5L11 13"/><path d="M21.5 2.5l-6.8 19-3.7-8.5-8.5-3.7z"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  quote: '<path d="M9 10L4 15l5 5"/><path d="M4 15h11a5 5 0 0 0 5-5V5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  outline: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  bulb: '<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3a6.5 6.5 0 0 0-3.6 11.9V17h7.2v-2.1A6.5 6.5 0 0 0 12 3z"/>',
  polish: '<path d="M12 3.5l1.9 4.6L18.5 10l-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  aZh: '<path d="M4 6h8"/><path d="M8 3.5V6"/><path d="M4.8 9.6c1.4 2.6 3.4 4.2 5.8 4.9"/><path d="M9.8 9.6C8.4 12.2 6.4 13.8 4 14.6"/><path d="M13.6 20l3.4-8 3.4 8"/><path d="M15 17h4"/>',
  coin: '<circle cx="12" cy="12" r="8.6"/><path d="M8.8 9.2h6.4M12 9.2v5.6M9.6 14.8h4.8"/>',
  wallet: '<rect x="3" y="6.6" width="18" height="12.8" rx="2.6"/><path d="M3 10.8h18"/><circle cx="16.6" cy="15" r="1.3"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
};

const TOOL_ICON_RULES = [
  [/大纲|分段|要点/, 'outline'],
  [/总结|摘要|结论/, 'book'],
  [/翻译|译成/, 'translate'],
  [/解释|术语|白话/, 'bulb'],
  [/润色|改写|优化|简洁/, 'polish'],
  [/提问|问题|问答/, 'sparkle'],
];

function iconSvg(name) {
  const body = ICONS[name] || ICONS.grid;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function toolIcon(label) {
  for (const [pattern, name] of TOOL_ICON_RULES) if (pattern.test(label)) return name;
  return 'grid';
}

// 静态按钮靠 data-icon 占位，这里统一灌进 SVG，文字只留在 data-tip 里
function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    el.innerHTML = iconSvg(el.dataset.icon);
    el.setAttribute("aria-label", el.dataset.tip || el.dataset.icon);
  }
}

hydrateIcons();

function currentModel() {
  return state.config?.models?.find((m) => m.modelId === state.model) || null;
}

// ---------- 存储与后端 ----------

async function loadState() {
  const saved = await chrome.storage.local.get(STORE_KEYS);
  state.server = (saved.server || DEFAULT_SERVER).replace(/\/+$/, "");
  state.token = saved.token || "";
  state.deviceId = saved.deviceId || "";
  state.label = saved.label || "";
  state.model = saved.model || "";
  state.sessions = Array.isArray(saved.sessions) ? saved.sessions : [];
  state.activeId = saved.activeSession || "";
}

function saveState(patch) {
  return chrome.storage.local.set(patch);
}

function saveSessions() {
  const trimmed = state.sessions.slice(0, MAX_SESSIONS).map((session) => ({
    ...session,
    messages: session.messages.slice(-60).map((m) => ({ ...m })),
  }));
  state.sessions = trimmed;
  return saveState({ sessions: trimmed, activeSession: state.activeId });
}

async function readJson(response) {
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // 非 JSON 响应按状态码处理
  }
  if (!response.ok) {
    throw new UiError(data?.message || `请求失败（HTTP ${response.status}）`);
  }
  return data;
}

async function registerDevice() {
  const response = await fetch(`${state.server}/api/device/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: state.deviceId, label: state.label || "Edge 扩展" }),
  });
  const data = await readJson(response);
  state.token = data.token;
  state.balance = data.balance;
  await saveState({ token: data.token });
  renderBalance();
}

async function loadConfig() {
  const response = await fetch(`${state.server}/api/config`);
  const config = await readJson(response);
  state.config = config;

  if (!config.models.some((m) => m.modelId === state.model)) {
    state.model = config.models[0]?.modelId || "";
    if (state.model) await saveState({ model: state.model });
  }
  renderModels();
  renderTools();
  renderAskList();
  renderNotice();
  renderVoiceButton();
  setStatus(config.chatEnabled ? "已连接" : "服务已暂停", config.chatEnabled ? "" : "error");
}

function renderModels() {
  els.model.textContent = "";
  if (!state.config?.models?.length) {
    const option = document.createElement("option");
    option.textContent = "后台未启用任何模型";
    els.model.append(option);
    els.model.disabled = true;
    return;
  }
  els.model.disabled = false;
  for (const model of state.config.models) {
    const option = document.createElement("option");
    option.value = model.modelId;
    option.textContent = model.displayName;
    option.selected = model.modelId === state.model;
    option.title = `输入 ${model.inputRatePer1K}／输出 ${model.outputRatePer1K} 积分每千 token${model.supportsVision ? " · 支持图片" : ""}`;
    els.model.append(option);
  }
}

function renderNotice() {
  const notice = state.config?.notice?.trim();
  els.notice.hidden = !notice;
  if (notice) els.notice.textContent = notice;
}

function renderBalance() {
  const balance = state.balance;
  els.popBalance.textContent = balance === undefined || balance === null ? "—" : String(balance);
  els.popCredits.classList.toggle("low", typeof balance === "number" && balance <= 50);
}

function renderAccountCard() {
  els.popDevice.textContent = state.label || "本机设备";
  els.popVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  els.rechargeDevice.value = state.deviceId || "";
}

function syncBusy() {
  els.send.disabled = state.busy;
  els.stop.hidden = !state.busy;
  els.btnShot.disabled = state.busy;
  els.btnFile.disabled = state.busy;
  els.btnVoice.disabled = state.busy;
  for (const button of els.tools.querySelectorAll("button")) button.disabled = state.busy;
  for (const button of els.selectionCard.querySelectorAll("button")) button.disabled = state.busy;
  for (const button of els.translateView.querySelectorAll("button")) button.disabled = state.busy;
  // 气泡里的操作按钮是生成时渲染的，state.busy 复位后必须回填，否则复制/引用/重新生成永久禁用
  for (const button of els.thread.querySelectorAll(".msg-actions button")) button.disabled = state.busy;
}

async function refreshCredits() {
  if (!state.token) return null;
  const response = await fetch(`${state.server}/api/credits`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  const data = await readJson(response);
  state.balance = data.balance;
  renderBalance();
  return data;
}

// ---------- 视图切换 ----------

function showView(name, { focusInput = false } = {}) {
  state.view = name;
  for (const button of els.rail.querySelectorAll("button[data-view]")) {
    button.classList.toggle("active", button.dataset.view === name);
  }
  els.chatView.hidden = name !== "chat";
  els.askView.hidden = name !== "ask";
  els.translateView.hidden = name !== "translate";
  els.toolsView.hidden = name !== "tools";
  els.settingsView.hidden = name !== "settings";
  els.viewTitle.textContent = VIEW_TITLES[name] || "聊天";

  if (name === "settings") fillSettings();
  if (name === "translate") renderTranslatePane();
  if (name === "chat" && focusInput) els.input.focus();
}

function fillSettings() {
  els.serverInput.value = state.server;
  els.labelInput.value = state.label;
  els.deviceInput.value = state.deviceId;
  els.tokenInput.value = state.token;
  els.brandVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  renderAccountCard();
}

// ---------- 页面正文、划词与截图 ----------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab && /^https?:/i.test(tab.url || "") ? tab : null;
}

async function extractPage() {
  const tab = await activeTab();
  if (!tab) throw new UiError("请先切到要读取的网页标签页（扩展页面无法读取）");
  if (state.pageCache && state.pageCache.url === tab.url && Date.now() - state.pageCache.at < 60_000) {
    return state.pageCache;
  }

  let payload = null;
  try {
    payload = await chrome.tabs.sendMessage(tab.id, { type: "extract" });
  } catch {
    payload = await injectExtract(tab.id);
  }
  if (!payload?.text) throw new UiError("这个页面没能提取到正文，可能是浏览器内置页面或内容为空");

  state.pageCache = { ...payload, at: Date.now() };
  return state.pageCache;
}

async function injectExtract(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (typeof spExtract === "function" ? spExtract() : null),
    });
    if (result?.result) return result.result;
  } catch {
    // 继续尝试注入脚本文件
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["shared/extract.js"] });
  const [retry] = await chrome.scripting.executeScript({ target: { tabId }, func: () => spExtract() });
  return retry?.result;
}

async function syncSelection() {
  const tab = await activeTab();
  if (!tab) {
    state.selection = "";
    renderSelectionCard();
    return state.selection;
  }
  try {
    const data = await chrome.tabs.sendMessage(tab.id, { type: "get-selection" });
    state.selection = (data?.selection || "").trim();
  } catch {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection() || "").trim(),
    });
    state.selection = (result?.result || "").trim();
  }
  renderSelectionCard();
  if (state.view === "translate") renderTranslatePane();
  return state.selection;
}

function renderSelectionCard() {
  const has = Boolean(state.selection);
  els.selectionCard.hidden = !has;
  if (has) els.selectionText.textContent = clip(state.selection, 120);
}

function renderTranslatePane() {
  els.translateSource.textContent = state.selection
    ? state.selection
    : "还没有选中文字。先在网页里划选一段，再点下面的按钮。";
  els.translateZh.disabled = state.busy || !state.selection;
  els.translateEn.disabled = state.busy || !state.selection;
}

async function captureScreenshot() {
  const tab = await activeTab();
  if (!tab) throw new UiError("请先切到要截图的网页标签页");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  addImageAttachment(dataUrl, `网页截图 ${state.attachments.filter((a) => a.kind === "image").length + 1}.png`);
  setStatus("已插入截图");
}

function addImageAttachment(dataUrl, name) {
  if (dataUrl.length > MAX_ATTACH_CHARS) {
    setStatus("截图太大，请先缩小窗口或改用图片文件", "error");
    return;
  }
  state.attachments.push({ kind: "image", name, dataUrl });
  renderAttachments();
}

function addTextAttachment(name, text) {
  state.attachments.push({
    kind: "text",
    name,
    text: text.length > MAX_TEXT_FILE_CHARS ? `${text.slice(0, MAX_TEXT_FILE_CHARS)}…（后面已截断）` : text,
  });
  renderAttachments();
}

function renderAttachments() {
  els.attachments.textContent = "";
  els.attachments.hidden = state.attachments.length === 0;
  state.attachments.forEach((item, index) => {
    const chip = document.createElement("div");
    chip.className = "attach";
    if (item.kind === "image") {
      const img = document.createElement("img");
      img.src = item.dataUrl;
      img.alt = item.name;
      chip.append(img);
    } else {
      const badge = document.createElement("span");
      badge.textContent = "文本";
      badge.style.color = "var(--muted)";
      chip.append(badge);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.name;
    name.title = item.text ? `${item.name}（${item.text.length} 字）` : item.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "移除";
    remove.addEventListener("click", () => {
      state.attachments.splice(index, 1);
      renderAttachments();
    });
    chip.append(name, remove);
    els.attachments.append(chip);
  });
}

function clearAttachments() {
  state.attachments = [];
  renderAttachments();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new UiError(`读取 ${file.name} 失败`));
    reader.onload = () => resolve(String(reader.result || ""));
    if (file.type.startsWith("image/")) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

// ---------- 会话 ----------

// ---------- 语音输入 ----------

const VOICE_MAX_SECONDS = 60;

function pickAudioMime() {
  if (typeof MediaRecorder === "undefined") return "";
  // 国内识别服务对 m4a 的兼容性普遍好于 webm，能用就优先
  const candidates = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function voiceFileExt(mime) {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function renderVoiceButton() {
  const recording = Boolean(state.voice);
  els.btnVoice.hidden = state.config?.voice?.enabled === false;
  els.btnVoice.setAttribute("aria-pressed", String(recording));
  els.btnVoice.classList.toggle("recording", recording);
  els.btnVoice.dataset.tip = recording
    ? "正在录音，点击结束并转成文字"
    : `语音输入：说完自动转成文字${state.config?.voice?.creditsPerCall ? `（每次 ${state.config.voice.creditsPerCall} 积分）` : ""}`;
}

async function toggleVoice() {
  if (state.voice) {
    stopVoice();
    return;
  }
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    toast("当前浏览器不支持录音，请升级 Edge 后重试。");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    const hint = err.name === "NotAllowedError"
      ? "麦克风权限被拒绝。请在 Edge 的「设置 → 隐私、搜索和服务 → 网站权限 → 麦克风」里允许扩展使用麦克风。"
      : err.name === "NotFoundError" || err.name === "OverconstrainedError"
        ? "没有可用的麦克风设备，请检查耳机或话筒。"
        : `无法开始录音：${err.message || err.name}`;
    setStatus("麦克风不可用", "error");
    toast(hint);
    return;
  }

  const mimeType = pickAudioMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  const voice = { recorder, stream, timer: 0, startedAt: Date.now() };

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  recorder.onerror = () => {
    cleanupVoice(voice);
    if (state.voice === voice) state.voice = null;
    renderVoiceButton();
    setStatus("录音中断", "error");
  };
  recorder.onstop = () => {
    cleanupVoice(voice);
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
    uploadVoice(blob).catch((err) => {
      showError(err);
      setStatus("语音转写失败", "error");
    });
  };

  state.voice = voice;
  renderVoiceButton();
  setStatus("正在录音 0 秒，再点一次结束");
  voice.timer = setInterval(() => {
    if (state.voice !== voice) return;
    const sec = Math.round((Date.now() - voice.startedAt) / 1000);
    if (sec >= VOICE_MAX_SECONDS) {
      toast(`录音到 ${VOICE_MAX_SECONDS} 秒自动结束`);
      stopVoice();
      return;
    }
    setStatus(`正在录音 ${sec} 秒，再点一次结束`);
  }, 1000);
  recorder.start();
}

function cleanupVoice(voice) {
  if (voice?.timer) clearInterval(voice.timer);
  voice?.stream?.getTracks().forEach((track) => track.stop());
}

function stopVoice() {
  const voice = state.voice;
  if (!voice) return;
  state.voice = null;
  clearInterval(voice.timer);
  renderVoiceButton();
  setStatus("正在转写…");
  // 先 stop 再释放麦克风，否则最后一段音频可能拿不到
  voice.recorder.stop();
}

async function uploadVoice(blob) {
  if (!blob.size) {
    setStatus("录音是空的", "error");
    return;
  }
  if (!state.token) await registerDevice();

  const form = new FormData();
  form.append("file", blob, `voice-${Date.now()}.${voiceFileExt(blob.type)}`);
  const response = await fetch(`${state.server}/api/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}` },
    body: form,
  });
  const data = await readJson(response);

  const text = (data?.text || "").trim();
  if (!text) {
    setStatus("没有识别到文字", "error");
    return;
  }
  insertAtCursor(text);
  if (typeof data.balance === "number") {
    state.balance = data.balance;
    renderBalance();
  }
  setStatus(`已识别 ${text.length} 字`);
}

function insertAtCursor(text) {
  const input = els.input;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  const caret = start + text.length;
  input.focus();
  input.setSelectionRange(caret, caret);
}

function activeSession() {
  let session = state.sessions.find((item) => item.id === state.activeId);
  if (!session) {
    session = { id: crypto.randomUUID(), title: "新聊天", updatedAt: Date.now(), messages: [] };
    state.sessions.unshift(session);
    state.activeId = session.id;
  }
  return session;
}

function appendMessage(kind, text) {
  document.querySelector(".thread .hint, .thread .empty-hero")?.remove();
  const box = document.createElement("div");
  box.className = `msg ${kind}`;
  box.textContent = text;
  els.thread.append(box);
  els.thread.scrollTop = els.thread.scrollHeight;
  return box;
}

function appendMeta(box, text) {
  if (!text) return;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = text;
  box.append(meta);
}

function appendThinking(box) {
  const details = document.createElement("details");
  details.className = "reasoning";
  const summary = document.createElement("summary");
  summary.textContent = "思考中…";
  const text = document.createElement("div");
  text.className = "reasoning-body";
  details.append(summary, text);
  // 思考过程放折叠块里并置顶，默认收起，避免推理流水把正文挤走
  box.prepend(details);
  return { details, summary, text };
}

function messageBox(msg, index) {
  document.querySelector(".thread .hint, .thread .empty-hero")?.remove();
  const box = document.createElement("div");
  box.className = `msg ${msg.role}`;
  if (msg.reasoning) {
    const thinking = appendThinking(box);
    thinking.summary.textContent = msg.content ? "思考过程" : "思考过程（未生成回答）";
    thinking.text.textContent = msg.reasoning;
  }
  const body = document.createElement("div");
  body.className = "msg-body";
  body.textContent = msg.content;
  box.append(body);
  if (msg.images) appendMeta(box, `附带 ${msg.images} 张图片（历史图片不再重复发送）`);
  if (msg.note) appendMeta(box, msg.note);
  if (msg.usage) appendMeta(box, msg.usage);
  box.append(messageActions(msg, index));
  return box;
}

function messageActions(msg, index) {
  const row = document.createElement("div");
  row.className = "msg-actions";
  const add = (label, handler, iconName) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ico tip-top";
    button.dataset.tip = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = iconSvg(iconName);
    button.disabled = state.busy;
    button.addEventListener("click", handler);
    row.append(button);
  };

  add("复制", async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setStatus("已复制到剪贴板");
    } catch {
      setStatus("复制失败，请手动选择文字", "error");
    }
  }, "copy");
  add("引用", () => {
    els.input.value = `> ${msg.content.split("\n").join("\n> ")}\n\n${els.input.value}`.trimStart();
    showView("chat", { focusInput: true });
    els.input.focus();
  }, "quote");
  if (msg.role === "assistant" && index === lastIndexOf("assistant")) {
    add("重新生成", () => regenerate().catch(showError), "refresh");
  }
  return row;
}

function lastIndexOf(role) {
  const messages = activeSession().messages;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === role) return i;
  }
  return -1;
}

function renderThread() {
  els.thread.textContent = "";
  const messages = activeSession().messages;
  if (!messages.length) {
    // 空会话时仿 Sider 的居中引导区：图标 + 标题 + 快捷提问
    const hero = document.createElement("div");
    hero.className = "empty-hero";
    const logo = document.createElement("img");
    logo.src = "../icons/icon48.png";
    logo.alt = "";
    const heading = document.createElement("h2");
    heading.textContent = "有什么可以帮你？";
    const sub = document.createElement("p");
    sub.textContent = "直接提问，或用右侧「工具」处理整页与划线内容";
    const chips = document.createElement("div");
    chips.className = "hero-chips";
    for (const item of QUICK_ASKS.slice(0, 4)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = item.text;
      chip.addEventListener("click", () => {
        els.input.value = item.text;
        setReadPage(item.page);
        els.input.focus();
        setStatus("已填入快捷提问，可直接发送");
      });
      chips.append(chip);
    }
    hero.append(logo, heading, sub, chips);
    els.thread.append(hero);
    return;
  }
  messages.forEach((msg, index) => els.thread.append(messageBox(msg, index)));
  els.thread.scrollTop = els.thread.scrollHeight;
}

async function newChat() {
  const session = activeSession();
  if (!session.messages.length) {
    setStatus("已经是新聊天");
    return;
  }
  state.sessions.unshift({ id: crypto.randomUUID(), title: "新聊天", updatedAt: Date.now(), messages: [] });
  state.activeId = state.sessions[0].id;
  state.lastRequest = null;
  state.pageCache = null;
  clearAttachments();
  renderThread();
  await saveSessions();
  showView("chat", { focusInput: true });
  setStatus("已新建聊天");
}

function renderHistory() {
  els.historyList.textContent = "";
  const sessions = state.sessions.filter((item) => item.messages.length);
  if (!sessions.length) {
    const li = document.createElement("li");
    li.textContent = "还没有历史聊天。";
    els.historyList.append(li);
    return;
  }
  for (const session of sessions) {
    const li = document.createElement("li");
    if (session.id === state.activeId) li.className = "active-session";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "item-main";
    main.textContent = session.title || "未命名聊天";
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = `${new Date(session.updatedAt).toLocaleString("zh-CN")} · ${session.messages.length} 条`;
    main.append(when);
    main.addEventListener("click", async () => {
      state.activeId = session.id;
      state.lastRequest = null;
      renderThread();
      await saveSessions();
      els.historyDialog.close();
      showView("chat");
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      state.sessions = state.sessions.filter((item) => item.id !== session.id);
      if (state.activeId === session.id) {
        state.activeId = state.sessions[0]?.id || "";
        renderThread();
      }
      renderHistory();
      await saveSessions();
    });
    li.append(main, remove);
    els.historyList.append(li);
  }
}

function trimForApi(message) {
  const limit = 3000;
  // 会话里存的是展示用的短标签，实际发给模型的正文存在 prompt 上
  const text = message.role === "user" ? message.prompt || message.content : message.content;
  return {
    role: message.role,
    content: text.length > limit ? `${text.slice(0, limit)}…（更早正文已省略）` : text,
  };
}

// ---------- 生成 ----------

async function streamChat(messages, onDelta, onReasoning) {
  const controller = new AbortController();
  state.controller = controller;

  const response = await fetch(`${state.server}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ model: state.model, messages }),
    signal: controller.signal,
  });

  if (!response.ok) {
    await readJson(response); // 统一抛出后端错误信息
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let doneEvent = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const line = chunk.split("\n").find((item) => item.startsWith("data:"));
      if (!line) continue;
      const event = JSON.parse(line.slice(5).trim());
      if (event.type === "delta") onDelta(event.text);
      else if (event.type === "reasoning") onReasoning?.(event.text);
      else if (event.type === "done") doneEvent = event;
      else if (event.type === "error") throw new UiError(event.error || "生成失败");
    }
  }
  return doneEvent;
}

async function ask({ label, content, images = [], note = "" }) {
  if (state.busy) {
    setStatus("上一条还在生成中", "error");
    return;
  }
  if (images.length && !currentModel()?.supportsVision) {
    setStatus("当前模型不支持图片", "error");
    toast(`「${currentModel()?.displayName || state.model}」不支持图片，请在输入框左侧切换到支持图片的模型，例如智谱 GLM-4V-Flash。`);
    return;
  }
  if (!state.token) await registerDevice();

  const session = activeSession();
  const history = session.messages.slice(-HISTORY_TURNS).map(trimForApi);
  const apiMessages = [...history, { role: "user", content, images }];

  const userMessage = { role: "user", content: label, prompt: content, note, images: images.length, at: Date.now() };
  session.messages.push(userMessage);
  if (session.title === "新聊天") session.title = clip(label || content, 24);
  session.updatedAt = Date.now();
  const userBox = messageBox(userMessage, session.messages.length - 1);
  els.thread.append(userBox);
  els.thread.scrollTop = els.thread.scrollHeight;

  const box = appendMessage("assistant streaming", "");
  // 正文写进独立节点，思考块才能和它并存（直接给 box.textContent 赋值会抹掉兄弟节点）
  const body = document.createElement("div");
  body.className = "msg-body";
  box.textContent = "";
  box.append(body);

  let answer = "";
  let reasoning = "";
  let thinking = null;
  let phase = "waiting";
  state.busy = true;
  state.lastRequest = { label, content, images, note };
  syncBusy();
  setStatus("正在请求模型…");

  try {
    const done = await streamChat(apiMessages,
      (piece) => {
        answer += piece;
        body.textContent = answer;
        if (phase !== "answer") {
          phase = "answer";
          setStatus("生成中…");
          els.stop.dataset.tip = "停止生成";
          if (thinking) thinking.summary.textContent = "思考过程";
        }
        els.thread.scrollTop = els.thread.scrollHeight;
      },
      (piece) => {
        reasoning += piece;
        if (!thinking) thinking = appendThinking(box);
        thinking.text.textContent = reasoning;
        if (phase !== "thinking") {
          phase = "thinking";
          setStatus("思考中…");
          els.stop.dataset.tip = "终止思考";
        }
        els.thread.scrollTop = els.thread.scrollHeight;
      });

    box.classList.remove("streaming");
    if (!answer) {
      box.classList.add("error");
      body.textContent = "模型没有返回内容";
    } else if (done) {
      state.balance = done.balance;
      renderBalance();
      const usage = done.usage || {};
      const summary = `${state.model} · 输入 ${usage.inputTokens ?? 0}／输出 ${usage.outputTokens ?? 0} token`;
      appendMeta(box, summary);
      setStatus("已连接");
    }

    if (answer) {
      const assistantMessage = { role: "assistant", content: answer, reasoning: clip(reasoning, 1600), usage: box.querySelector(".meta")?.textContent || "", at: Date.now() };
      session.messages.push(assistantMessage);
      box.append(messageActions(assistantMessage, session.messages.length - 1));
    }
    await saveSessions();
  } catch (err) {
    box.classList.remove("streaming");
    if (err.name === "AbortError") {
      const stopped = phase === "thinking" ? "已终止思考" : "已手动停止";
      setStatus(stopped);
      if (answer) {
        appendMeta(box, stopped);
        session.messages.push({ role: "assistant", content: answer, reasoning: clip(reasoning, 1600), note: stopped, at: Date.now() });
        box.append(messageActions({ role: "assistant", content: answer }, session.messages.length - 1));
        await saveSessions();
      } else if (thinking) {
        // 思考到一半被终止：气泡留着讲清楚，但不写进会话，免得历史里出现一条空回答
        thinking.summary.textContent = "思考过程（已终止）";
        body.textContent = "已停止，未生成回答";
      } else {
        box.remove();
      }
    } else {
      const detail = err instanceof TypeError
        ? `连不上后端 ${state.server}，请在右侧「设置」检查服务器地址`
        : err.message || "生成失败";
      setStatus(detail, "error");
      if (answer) {
        appendMeta(box, `已中断：${detail}`);
        session.messages.push({ role: "assistant", content: answer, note: `已中断：${detail}`, at: Date.now() });
      } else {
        box.classList.add("error");
        body.textContent = detail;
      }
      state.lastRequest = null;
    }
    await refreshCredits().catch(() => {});
  } finally {
    state.busy = false;
    state.controller = null;
    els.stop.dataset.tip = "停止生成";
    syncBusy();
    els.thread.scrollTop = els.thread.scrollHeight;
  }
}

async function regenerate() {
  const request = state.lastRequest;
  if (!request) {
    setStatus("这条没法重新生成", "error");
    return;
  }
  const session = activeSession();
  while (session.messages.length && session.messages.at(-1).role === "assistant") session.messages.pop();
  if (session.messages.at(-1)?.role === "user") session.messages.pop();
  renderThread();
  await saveSessions();
  await ask(request);
}

async function runAction(actionId, extra = {}) {
  const action = state.config?.actions?.find((item) => item.id === actionId);
  if (!action) {
    setStatus("后台未配置该动作", "error");
    return;
  }

  const template = action.prompt;
  const question = (extra.question ?? els.input.value).trim();
  let page = "";
  let selection = (extra.selection || state.selection || "").trim();
  const images = extra.images || [];

  try {
    if (template.includes("{{page}}")) {
      const payload = await extractPage();
      page = payload.text;
    }
    if (template.includes("{{selection}}") && !selection) {
      selection = await syncSelection();
    }
    if (template.includes("{{selection}}") && !selection) {
      setStatus("请先在网页里选中要处理的文字", "error");
      return;
    }
    if (template.includes("{{question}}") && !question) {
      setStatus("请先在下方输入问题", "error");
      els.input.focus();
      return;
    }
  } catch (err) {
    showError(err);
    return;
  }

  const prompt = template
    .replaceAll("{{page}}", page)
    .replaceAll("{{selection}}", selection)
    .replaceAll("{{question}}", question);

  const label = question && template.includes("{{question}}")
    ? question
    : `${action.label}${selection ? `：${clip(selection, 60)}` : ""}`;
  const noteParts = [];
  if (page) noteParts.push(`本页正文 ${page.length.toLocaleString()} 字 · ${clip(state.pageCache?.url || "", 60)}`);
  if (extra.note) noteParts.push(extra.note);

  if (extra.question === undefined) els.input.value = "";
  showView("chat");
  await ask({ label, content: prompt, images, note: noteParts.join(" · ") });
}

function renderTools() {
  els.tools.textContent = "";
  for (const action of state.config?.actions || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = iconSvg(toolIcon(action.label));
    const label = document.createElement("span");
    label.textContent = action.label;
    const desc = document.createElement("span");
    desc.className = "tool-desc";
    desc.textContent = action.prompt.includes("{{page}}")
      ? "读整页正文"
      : action.prompt.includes("{{selection}}")
        ? "需要划选文字"
        : "可选";
    button.append(label, desc);
    button.disabled = state.busy;
    button.addEventListener("click", () => runAction(action.id, {}).catch(showError));
    els.tools.append(button);
  }
}

function renderAskList() {
  els.askList.textContent = "";
  for (const item of QUICK_ASKS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.text;
    button.addEventListener("click", () => {
      els.input.value = item.text;
      setReadPage(item.page);
      showView("chat", { focusInput: true });
    });
    els.askList.append(button);
  }
}

function setReadPage(on) {
  state.readPage = on;
  els.btnReadPage.setAttribute("aria-pressed", String(on));
  // 图标按钮没有文字可看，开启状态写进气泡里
  els.btnReadPage.dataset.tip = on ? "阅读此页：已开启，发送时带本页正文" : "阅读此页：发送时带上本页正文";
}

// ---------- 事件绑定 ----------

els.rail.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  showView(button.dataset.view);
  if (button.dataset.view === "translate" || button.dataset.view === "chat") await syncSelection();
});

els.model.addEventListener("change", async () => {
  state.model = els.model.value;
  await saveState({ model: state.model });
  setStatus(`已切换到 ${currentModel()?.displayName || state.model}`);
});

els.btnReadPage.addEventListener("click", () => {
  setReadPage(!state.readPage);
  setStatus(state.readPage ? "发送时会带上本页正文" : "已取消带上本页");
});

els.btnShot.addEventListener("click", async () => {
  try {
    await captureScreenshot();
  } catch (err) {
    showError(err);
  }
});

els.btnFile.addEventListener("click", () => els.filePicker.click());

els.btnVoice.addEventListener("click", () => toggleVoice().catch(showError));

els.filePicker.addEventListener("change", async () => {
  const files = [...els.filePicker.files || []];
  els.filePicker.value = "";
  for (const file of files) {
    try {
      const value = await readFile(file);
      if (file.type.startsWith("image/")) addImageAttachment(value, file.name);
      else addTextAttachment(file.name, value);
    } catch (err) {
      showError(err);
    }
  }
  if (files.length) setStatus(`已附加 ${files.length} 个文件`);
});

els.send.addEventListener("click", () => send().catch(showError));

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send().catch(showError);
  }
});

async function send() {
  const question = els.input.value.trim();
  const images = state.attachments.filter((a) => a.kind === "image").map((a) => a.dataUrl);
  const files = state.attachments.filter((a) => a.kind === "text");
  if (!question && !images.length && !files.length) {
    els.input.focus();
    return;
  }

  const fileBlock = files.map((f) => `【文件 ${f.name}】\n${f.text}`).join("\n\n");
  const content = [question, fileBlock].filter(Boolean).join("\n\n");
  const note = files.length ? `附加 ${files.length} 个文件` : "";
  const label = question || (images.length ? `看图 ${images.length} 张` : `附加 ${files.length} 个文件`);

  if (images.length && !currentModel()?.supportsVision) {
    await ask({ label, content, images, note }); // 由 ask 统一提示换模型，附件保留在输入条
    return;
  }

  clearAttachments();
  els.input.value = "";

  if (state.readPage) {
    await runAction("qa_page", { question: content, images, note });
    return;
  }
  await ask({ label, content, images, note });
}

els.stop.addEventListener("click", () => state.controller?.abort());

els.panelClose.addEventListener("click", () => window.close());

els.newChat.addEventListener("click", () => newChat().catch(showError));

els.openHistory.addEventListener("click", () => {
  renderHistory();
  els.historyDialog.showModal();
});

els.clearHistory.addEventListener("click", async () => {
  state.sessions = state.sessions.filter((item) => item.id === state.activeId);
  const current = activeSession();
  current.messages = [];
  current.title = "新聊天";
  renderThread();
  renderHistory();
  await saveSessions();
});

els.closeHistory.addEventListener("click", () => els.historyDialog.close());

els.selectionCard.addEventListener("click", (event) => {
  if (event.target.id === "runSelection") runAction("translate", {}).catch(showError);
});

els.refreshSelection.addEventListener("click", () => syncSelection().catch(showError));
els.translateZh.addEventListener("click", () => runAction("translate", { selection: state.selection }).catch(showError));
els.translateEn.addEventListener("click", () => runAction("translate-en", { selection: state.selection }).catch(showError));

function openCreditsDialog() {
  els.creditsBalance.textContent = "…";
  els.transactions.textContent = "";
  renderAccountCard();
  els.creditsDialog.showModal();
  return loadCreditsList();
}

els.openCredits.addEventListener("click", () => openCreditsDialog().catch(showError));

els.copyRechargeDevice.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.deviceId || "");
    setStatus("已复制设备 ID");
  } catch {
    setStatus("复制失败，请手动选择", "error");
  }
});

// 头像浮层：悬浮即出（CSS），点击/键盘也能开，离开或选中菜单后收起
function closeAccountPop() {
  els.avatarDock.classList.remove("open");
  els.avatar.setAttribute("aria-expanded", "false");
}

els.avatar.addEventListener("click", () => {
  const open = els.avatarDock.classList.toggle("open");
  els.avatar.setAttribute("aria-expanded", String(open));
});

els.accountPop.addEventListener("click", (event) => {
  const item = event.target.closest("[data-pop]");
  if (!item) return;
  closeAccountPop();
  if (item.dataset.pop === "credits") openCreditsDialog().catch(showError);
  else if (item.dataset.pop === "history") {
    renderHistory();
    els.historyDialog.showModal();
  } else if (item.dataset.pop === "settings") showView("settings");
});

els.popRecharge.addEventListener("click", () => {
  closeAccountPop();
  openCreditsDialog().catch(showError);
});

document.addEventListener("click", (event) => {
  if (!els.avatarDock.contains(event.target)) closeAccountPop();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAccountPop();
});

els.refreshCredits.addEventListener("click", loadCreditsList);
els.closeCredits.addEventListener("click", () => els.creditsDialog.close());

async function loadCreditsList() {
  try {
    const data = await refreshCredits();
    if (!data) return;
    els.creditsBalance.textContent = String(data.balance);
    els.transactions.textContent = "";
    for (const item of data.transactions) {
      const li = document.createElement("li");
      const delta = document.createElement("span");
      delta.className = `delta ${item.delta >= 0 ? "plus" : "minus"}`;
      delta.textContent = item.delta >= 0 ? `+${item.delta}` : String(item.delta);
      const reason = document.createElement("span");
      reason.textContent = item.modelId
        ? `${REASON_LABELS[item.reason] || item.reason}（${item.modelId} ${item.inputTokens}/${item.outputTokens}）`
        : REASON_LABELS[item.reason] || item.reason;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = item.at;
      li.append(delta, reason, when);
      els.transactions.append(li);
    }
  } catch (err) {
    showError(err);
  }
}

els.saveSettings.addEventListener("click", async () => {
  const server = els.serverInput.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(server)) {
    setStatus("服务器地址要以 http:// 或 https:// 开头", "error");
    return;
  }
  const oldServer = state.server;
  state.server = server;
  state.label = els.labelInput.value.trim();
  state.pageCache = null;
  if (server !== oldServer) state.token = ""; // 换服务器后旧令牌无效，重新注册
  await saveState({ server, label: state.label, token: state.token });
  await boot();
  setStatus("已保存设置");
});

els.reregister.addEventListener("click", async () => {
  try {
    await registerDevice();
    fillSettings();
    setStatus("已重新注册");
  } catch (err) {
    showError(err);
  }
});

// 悬浮快捷栏开关：值只存在 storage 里给内容脚本读，面板这边负责显示当前值和写回
els.launcherToggle.addEventListener("change", () => {
  chrome.storage.local.set({ launcher: els.launcherToggle.checked });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "launcher" in changes) {
    els.launcherToggle.checked = changes.launcher.newValue !== false;
  }
});
chrome.storage.local.get("launcher").then((saved) => {
  els.launcherToggle.checked = saved.launcher !== false;
});

window.addEventListener("focus", () => syncSelection().catch(() => {}));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "pending-ready") {
    consumePending().catch(showError);
  }
});

// boot() 与 pending-ready 会同时到达，去重靠 pending.at 这个一次性标记：
// 检查与赋值之间不能有 await，否则两个并发调用都会通过。
let lastClaimedAt = 0;

async function consumePending() {
  const { pending } = await chrome.storage.local.get("pending");
  if (!pending) return;
  if (Date.now() - pending.at > 180_000) {
    await chrome.storage.local.remove("pending");
    return;
  }

  // 侧边栏按窗口各存一份实例，广播会让多个窗口看到同一次划词：不属于本窗口的不删，留给正确的窗口
  const current = await chrome.windows.getCurrent();
  if (pending.windowId && pending.windowId !== current.id) return;

  if (pending.at === lastClaimedAt) return;
  lastClaimedAt = pending.at;

  await chrome.storage.local.remove("pending");
  state.pageCache = null;
  showView(pending.view || "chat");
  if (pending.actionId) await runAction(pending.actionId, { selection: pending.selection });
}

async function boot() {
  try {
    await loadState();
    if (!state.deviceId) {
      state.deviceId = crypto.randomUUID();
      await saveState({ deviceId: state.deviceId });
    }
    if (!state.token) {
      await registerDevice();
    } else {
      await refreshCredits().catch(() => {
        state.token = "";
        return registerDevice();
      });
    }
    await loadConfig();
    activeSession();
    renderThread();
    renderAttachments();
    await saveSessions();
    await consumePending();
  } catch (err) {
    showError(err);
    setStatus(err.message || "后端未就绪", "error");
  } finally {
    renderAccountCard();
    syncBusy();
  }
}

boot();
