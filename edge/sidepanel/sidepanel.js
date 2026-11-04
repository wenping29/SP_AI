const DEFAULT_SERVER = "http://127.0.0.1:5080";
const STORE_KEYS = ["server", "token", "deviceId", "label", "model", "sessions", "activeSession", "user", "historyOwner", "deletedConversations"];
const REASON_LABELS = {
  device_trial: "新设备体验",
  free_grant: "注册赠送",
  device_merge: "本机积分合并",
  chat: "对话消耗",
  refund: "失败退款",
  voice: "语音输入",
  admin_grant: "后台调整",
};
const QUICK_ASKS = [
  { text: "用三句话讲清楚这个页面在说什么", page: true },
  { text: "这个页面有哪些关键数据和结论？", page: true },
  { text: "这个产品或功能适合谁？值不值得试？", page: true },
  { text: "把这段内容改写得更简洁、更正式", page: false },
  { text: "解释其中的专业术语和缩写", page: false },
  { text: "列出这段文字里我需要自己核对的事实", page: false },
];
const CAPABILITIES = {
  skill: {
    label: "技能",
    icon: "sparkle",
    hint: "给这条消息加一段处理指令",
    items: [
      { id: "summary", name: "精炼总结", desc: "先给结论，再列要点", prompt: "请先用一句话给出结论，再列出 3 到 6 条要点。" },
      { id: "outline", name: "分段大纲", desc: "按层级整理结构", prompt: "请把内容整理成清晰的分段大纲，最多三级。" },
      { id: "explain", name: "术语解释", desc: "把术语讲成白话", prompt: "请用通俗的中文解释其中的专业术语和缩写。" },
      { id: "polish", name: "润色改写", desc: "更简洁、更正式", prompt: "请把内容改写得更简洁、更正式，并说明主要改动。" },
      { id: "facts", name: "事实核对", desc: "标出待自行核实的事实", prompt: "请列出其中需要我自己核对的事实和依据。" },
    ],
  },
  plugin: {
    label: "插件",
    icon: "plug",
    hint: "给这条消息补充上下文",
    items: [
      { id: "page", name: "网页正文", desc: "带上当前页面正文提问", prompt: "" },
      { id: "selection", name: "划选文字", desc: "带上网页里选中的那段", prompt: "" },
      { id: "shot", name: "页面截图", desc: "发送时抓取可见区域", prompt: "" },
    ],
  },
  plan: {
    label: "计划",
    icon: "plan",
    hint: "先列步骤，再动手回答",
    items: [
      { id: "plan", name: "先出计划", desc: "先给分步计划再执行", prompt: "请先给出分步计划，再按计划逐步执行。" },
    ],
  },
  goal: {
    label: "目标",
    icon: "target",
    hint: "整个对话都围绕这个目标",
    items: [],
  },
};
const HISTORY_TURNS = 6;
const MAX_SESSIONS = 30;
const MAX_ATTACH_CHARS = 4_000_000;
const MAX_TEXT_FILE_CHARS = 6000;

const FULL_PAGE = new URLSearchParams(location.search).has("full");
if (FULL_PAGE) document.documentElement.dataset.full = "1";

const els = {
  layout: document.querySelector(".layout"),
  rail: document.getElementById("rail"),
  railFold: document.getElementById("railFold"),
  railFull: document.getElementById("railFull"),
  navToggle: document.getElementById("navToggle"),
  navMenu: document.getElementById("navMenu"),
  navGrid: document.getElementById("navGrid"),
  navExpand: document.getElementById("navExpand"),
  navFull: document.getElementById("navFull"),
  navNew: document.getElementById("navNew"),
  navHistory: document.getElementById("navHistory"),
  navAvatar: document.getElementById("navAvatar"),
  status: document.getElementById("status"),
  notice: document.getElementById("notice"),
  newChat: document.getElementById("newChat"),
  openHistory: document.getElementById("openHistory"),
  brandVersion: document.getElementById("brandVersion"),
  chatView: document.getElementById("chatView"),
  thread: document.getElementById("thread"),
  selectionCard: document.getElementById("selectionCard"),
  selectionText: document.getElementById("selectionText"),
  runSelection: document.getElementById("runSelection"),
  picks: document.getElementById("picks"),
  attachments: document.getElementById("attachments"),
  btnAdd: document.getElementById("btnAdd"),
  addMenu: document.getElementById("addMenu"),
  menuBody: document.getElementById("menuBody"),
  input: document.getElementById("input"),
  modelPicker: document.getElementById("modelPicker"),
  modelButton: document.getElementById("modelButton"),
  modelLogo: document.getElementById("modelLogo"),
  modelName: document.getElementById("modelName"),
  modelMenu: document.getElementById("modelMenu"),
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
  historySync: document.getElementById("historySync"),
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
  popAuth: document.getElementById("popAuth"),
  popAuthIcon: document.getElementById("popAuthIcon"),
  popAuthLabel: document.getElementById("popAuthLabel"),
  authDialog: document.getElementById("authDialog"),
  authTitle: document.getElementById("authTitle"),
  authEmail: document.getElementById("authEmail"),
  authName: document.getElementById("authName"),
  authNameRow: document.getElementById("authNameRow"),
  authPassword: document.getElementById("authPassword"),
  authCodeRow: document.getElementById("authCodeRow"),
  authCode: document.getElementById("authCode"),
  authSendCode: document.getElementById("authSendCode"),
  authError: document.getElementById("authError"),
  authTip: document.getElementById("authTip"),
  authSubmit: document.getElementById("authSubmit"),
  authCancel: document.getElementById("authCancel"),
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
  caps: { skills: [], plugins: [], plan: false },
  menuTab: "skill",
  readPage: false,
  pageCache: null,
  controller: null,
  voice: null,
  busy: false,
  balance: undefined,
  user: null,
  accountDeviceId: "",
  authMode: "login",
  historyOwner: "",
  deleted: {},
  lastRequest: null,
  collapsed: false,
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
  plus: '<path d="M12 5v14M5 12h14"/>',
  plug: '<path d="M9 4.5a2 2 0 0 1 4 0V6h3.5A1.5 1.5 0 0 1 18 7.5V11h-1.5a2 2 0 0 0 0 4H18v3.5a1.5 1.5 0 0 1-1.5 1.5H13v-1.5a2 2 0 0 0-4 0V20H5.5A1.5 1.5 0 0 1 4 18.5V15h1.5a2 2 0 0 0 0-4H4V7.5A1.5 1.5 0 0 1 5.5 6H9z"/>',
  plan: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  fold: '<path d="M11 5l6 7-6 7"/><path d="M20 4v16"/>',
  unfold: '<path d="M13 5l-6 7 6 7"/><path d="M4 4v16"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/>',
  user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/>',
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

// ---------- 输入框能力：技能 / 插件 / 计划 / 目标 ----------

function capItems(group) {
  return CAPABILITIES[group].items;
}

function findCap(group, id) {
  return capItems(group).find((item) => item.id === id) || null;
}

function selectedCaps(group) {
  const key = group === "skill" ? "skills" : "plugins";
  return state.caps[key].map((id) => findCap(group, id)).filter(Boolean);
}

function activeGoal() {
  return (activeSession().goal || "").trim();
}

function setGoal(text) {
  const session = activeSession();
  session.goal = text.trim();
  session.updatedAt = Date.now();
  renderPicks();
  saveSessions().catch(() => {});
}

function renderPicks() {
  const picks = [];
  for (const skill of selectedCaps("skill")) picks.push({ kind: "skill", id: skill.id, name: skill.name, icon: CAPABILITIES.skill.icon });
  for (const plugin of selectedCaps("plugin")) picks.push({ kind: "plugin", id: plugin.id, name: plugin.name, icon: CAPABILITIES.plugin.icon });
  if (state.caps.plan) picks.push({ kind: "plan", id: "plan", name: "先出计划", icon: CAPABILITIES.plan.icon });
  const goal = activeGoal();
  if (goal) picks.push({ kind: "goal", id: "goal", name: `目标：${clip(goal, 18)}`, icon: CAPABILITIES.goal.icon, tip: goal });

  els.picks.textContent = "";
  els.picks.hidden = picks.length === 0;
  for (const pick of picks) {
    const chip = document.createElement("span");
    chip.className = "pick";
    if (pick.tip) chip.dataset.tip = clip(pick.tip, 80);
    const mark = document.createElement("i");
    mark.className = "pick-ico";
    mark.innerHTML = iconSvg(pick.icon);
    const name = document.createElement("span");
    name.className = "pick-name";
    name.textContent = pick.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = `移除${pick.name}`;
    remove.addEventListener("click", () => removeCap(pick.kind, pick.id));
    chip.append(mark, name, remove);
    els.picks.append(chip);
  }
}

function capsNote() {
  const parts = [];
  const skills = selectedCaps("skill").map((item) => item.name);
  const plugins = selectedCaps("plugin").map((item) => item.name);
  if (skills.length) parts.push(`技能·${skills.join("、")}`);
  if (plugins.length) parts.push(`插件·${plugins.join("、")}`);
  if (state.caps.plan) parts.push("计划模式");
  const goal = activeGoal();
  if (goal) parts.push(`目标·${clip(goal, 16)}`);
  return parts.join(" · ");
}

function removeCap(kind, id) {
  if (kind === "goal") setGoal("");
  else if (kind === "plan") state.caps.plan = false;
  else if (kind === "skill") state.caps.skills = state.caps.skills.filter((item) => item !== id);
  else state.caps.plugins = state.caps.plugins.filter((item) => item !== id);
  renderPicks();
  if (els.addMenu.hidden) return;
  renderAddMenu();
}

function resetCaps() {
  state.caps = { skills: [], plugins: [], plan: false };
  renderPicks();
}

function toggleCap(group, id) {
  if (group === "plan") {
    state.caps.plan = !state.caps.plan;
  } else {
    const key = group === "skill" ? "skills" : "plugins";
    const list = state.caps[key];
    state.caps[key] = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  }
  renderPicks();
  renderAddMenu();
}

function menuRow({ icon, name, desc, on, onClick }) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `menu-item${on ? " on" : ""}`;
  const mark = document.createElement("span");
  mark.className = "menu-ico";
  mark.innerHTML = iconSvg(icon);
  const text = document.createElement("span");
  text.className = "menu-text";
  const title = document.createElement("span");
  title.className = "menu-name";
  title.textContent = name;
  const note = document.createElement("span");
  note.className = "menu-desc";
  note.textContent = desc;
  text.append(title, note);
  const check = document.createElement("span");
  check.className = "menu-check";
  check.innerHTML = iconSvg("check");
  row.append(mark, text, check);
  row.addEventListener("click", onClick);
  return row;
}

function renderAddMenu() {
  for (const tab of els.addMenu.querySelectorAll("[data-tab]")) {
    const active = tab.dataset.tab === state.menuTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }

  els.menuBody.textContent = "";
  const group = CAPABILITIES[state.menuTab];

  if (state.menuTab === "goal") {
    const wrap = document.createElement("div");
    wrap.className = "menu-goal";
    const hint = document.createElement("span");
    hint.className = "menu-desc";
    hint.textContent = group.hint;
    const input = document.createElement("input");
    input.id = "goalInput";
    input.type = "text";
    input.maxLength = 200;
    input.placeholder = "例如：帮我判断这个方案值不值得推进";
    input.value = activeGoal();
    const row = document.createElement("div");
    row.className = "row";
    const save = document.createElement("button");
    save.type = "button";
    save.id = "goalSave";
    save.className = "primary mini";
    save.textContent = input.value ? "更新目标" : "添加目标";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.id = "goalClear";
    clear.className = "ghost mini";
    clear.textContent = "清除";
    clear.hidden = !input.value;
    row.append(save, clear);
    wrap.append(hint, input, row);
    els.menuBody.append(wrap);
    return;
  }

  const selected = state.menuTab === "skill" ? state.caps.skills : state.caps.plugins;
  for (const item of group.items) {
    const on = state.menuTab === "plan" ? state.caps.plan : selected.includes(item.id);
    els.menuBody.append(menuRow({
      icon: group.icon,
      name: item.name,
      desc: item.desc,
      on,
      onClick: () => toggleCap(state.menuTab, item.id),
    }));
  }
}

function positionAddMenu() {
  const rect = els.btnAdd.getBoundingClientRect();
  const menu = els.addMenu;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const above = rect.top - height - 8;
  const top = above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - height - 8);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

// 各 tab 内容长度不同，统一按最高的那个撑开，切换时菜单不再跳动
let menuBodyHeight = 0;

function stabilizeMenuHeight() {
  if (!menuBodyHeight) {
    const current = state.menuTab;
    for (const key of Object.keys(CAPABILITIES)) {
      state.menuTab = key;
      renderAddMenu();
      menuBodyHeight = Math.max(menuBodyHeight, els.menuBody.scrollHeight);
    }
    state.menuTab = current;
  }
  els.menuBody.style.height = `${menuBodyHeight}px`;
  renderAddMenu();
}

function openAddMenu() {
  renderAddMenu();
  els.addMenu.hidden = false;
  els.btnAdd.setAttribute("aria-expanded", "true");
  stabilizeMenuHeight();
  positionAddMenu();
}

function closeAddMenu() {
  if (els.addMenu.hidden) return;
  els.addMenu.hidden = true;
  els.btnAdd.setAttribute("aria-expanded", "false");
}

function toggleAddMenu() {
  if (els.addMenu.hidden) openAddMenu();
  else closeAddMenu();
}

function currentModel() {
  return state.config?.models?.find((m) => m.modelId === state.model) || null;
}

// ---------- 模型切换：选中项与列表项都带厂商 logo ----------

const MODEL_LOGOS = {
  deepseek: {
    bg: "#4D6BFE",
    glyph:
      '<path fill="#fff" d="M3.8 14.6c0-2.9 2.3-5.2 5.2-5.2h3.2c1.2 0 2.3.6 3 1.6l2.9-1.1c.9-.4 1.9.6 1.5 1.5l-1.9 4.5c-.3.8-1 1.3-1.8 1.3h-1.6c-.5 0-.9-.4-.9-.9v-.5h-1.6l-1.3 1.8H5.3a1.5 1.5 0 0 1-1.5-1.5z"/><circle cx="7.6" cy="12.4" r=".9" fill="#4D6BFE"/>',
  },
  zhipu: {
    bg: "#3452FF",
    glyph: '<path fill="#fff" d="M7 6.8h10v2.5l-5.3 5.4H17v2.5H7v-2.5l5.3-5.4H7z"/>',
  },
  dashscope: {
    bg: "#7C5CFC",
    glyph:
      '<circle cx="12" cy="11.2" r="4.7" fill="none" stroke="#fff" stroke-width="2.3"/><path d="M14.6 14.3l2.9 2.9" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>',
  },
  qianfan: {
    bg: "#2932E1",
    glyph:
      '<path d="M12 5v.01M6.2 8.2h11.6M12 8.4l-4.7 9.4M12 11.4l4.7 6.4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  siliconflow: {
    bg: "#0FA47F",
    glyph:
      '<path d="M6.3 8.6c1.7-2.1 5.4-2 6.7.1 1 1.6.2 3.2-1.4 3.9l-2.1.9c-1.6.7-2.3 2.3-1.3 3.9 1.3 2.1 5 2.2 6.7.1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
  },
  unknown: {
    bg: "#64748B",
    glyph: '<path fill="#fff" d="M12 4.5l6 3.4v8.2l-6 3.4-6-3.4V7.9z"/>',
  },
};

function providerOf(model) {
  if (model?.provider) return model.provider;
  const id = model?.modelId || "";
  if (id.startsWith("glm")) return "zhipu";
  if (id.startsWith("deepseek")) return "deepseek";
  if (id.startsWith("qwen")) return "dashscope";
  if (id.startsWith("ernie")) return "qianfan";
  return "";
}

function logoMarkup(model) {
  const logo = MODEL_LOGOS[providerOf(model)] || MODEL_LOGOS.unknown;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="7" fill="${logo.bg}"/>${logo.glyph}</svg>`;
}

function modelTip(model) {
  const category = (model.category || "").trim();
  return `切换大模型：${model.displayName}${category ? ` · ${category}` : ""} · 输入 ${model.inputRatePer1K}／输出 ${model.outputRatePer1K} 积分每千 token${model.supportsVision ? " · 支持图片" : ""}`;
}

// 预设分类按由省到强的顺序排，自定义分类按出现顺序，未填分类的放最后
const MODEL_CATEGORY_ORDER = ["高性价比", "高级", "最智能"];

function groupModelsByCategory(models) {
  const groups = new Map();
  for (const model of models) {
    const name = (model.category || "").trim() || "未分类";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(model);
  }

  const names = [...groups.keys()].filter((name) => name !== "未分类");
  names.sort((a, b) => {
    const ai = MODEL_CATEGORY_ORDER.indexOf(a);
    const bi = MODEL_CATEGORY_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return 0;
  });
  if (groups.has("未分类")) names.push("未分类");

  return names.map((name) => ({ name, models: groups.get(name) }));
}

// 打开菜单前先向服务器要一次最新模型列表，后台增删模型无需重开面板
let configRefresh = null;
let configFetchedAt = 0;

async function fetchConfig() {
  const response = await fetch(`${state.server}/api/config`, { cache: "no-store" });
  const config = await readJson(response);
  state.config = config;
  if (!Array.isArray(config.models)) config.models = [];
  configFetchedAt = Date.now();

  if (!config.models.some((m) => m.modelId === state.model)) {
    state.model = config.models[0]?.modelId || "";
    if (state.model) await saveState({ model: state.model });
  }
  renderModels();
  renderTools();
  renderAskList();
  renderNotice();
  renderVoiceButton();
  return config;
}

function refreshConfig() {
  if (!configRefresh) {
    configRefresh = fetchConfig().finally(() => {
      configRefresh = null;
    });
  }
  return configRefresh;
}

async function openModelMenu() {
  try {
    await refreshConfig();
  } catch {
    // 服务器暂时不可达时沿用上次的模型列表
  }

  if (!state.config?.models?.length) {
    els.modelButton.disabled = true;
    els.modelName.textContent = "后台未启用任何模型";
    setStatus("后台未启用任何模型", "error");
    return;
  }

  els.modelMenu.hidden = false;
  els.modelButton.setAttribute("aria-expanded", "true");
  const active = els.modelMenu.querySelector('[aria-selected="true"]') || els.modelMenu.querySelector(".model-option");
  active?.focus();
}

function closeModelMenu(refocus = false) {
  if (els.modelMenu.hidden) return;
  els.modelMenu.hidden = true;
  els.modelButton.setAttribute("aria-expanded", "false");
  if (refocus) els.modelButton.focus();
}

async function toggleModelMenu() {
  if (els.modelMenu.hidden) await openModelMenu();
  else closeModelMenu();
}

async function selectModel(modelId) {
  const model = state.config?.models?.find((m) => m.modelId === modelId);
  if (!model) return;
  state.model = model.modelId;
  closeModelMenu(true);
  renderModels();
  await saveState({ model: state.model });
  setStatus(`已切换到 ${model.displayName}`);
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
  state.user = saved.user && saved.user.email ? saved.user : null;
  state.historyOwner = saved.historyOwner || "";
  state.deleted = pruneTombstones(saved.deletedConversations || {});
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
  const saving = saveState({ sessions: trimmed, activeSession: state.activeId });
  scheduleConversationPush();
  return saving;
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

// ---------- 聊天记录云同步：登录后按账号合并，未登录仍只存本机 ----------

const SYNC_MAX_MESSAGES = 60;
const SYNC_PROMPT_CHARS = 4000;
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000;
const syncedVersions = new Map(); // 会话 ID -> 已同步到云端的 updatedAt
let syncRunning = null;
let historyPushTimer = 0;

function conversationFetch(path, options = {}) {
  return fetch(`${state.server}/api/conversations${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  }).then(readJson);
}

function syncedPayload(session) {
  const build = (list) =>
    list.map((message) => {
      const copy = { role: message.role, content: message.content || "" };
      if (message.prompt) copy.prompt = message.prompt.slice(0, SYNC_PROMPT_CHARS);
      if (message.note) copy.note = message.note;
      if (message.images) copy.images = message.images;
      if (message.reasoning) copy.reasoning = message.reasoning.slice(0, 8000);
      if (message.usage) copy.usage = message.usage;
      if (message.at) copy.at = message.at;
      return copy;
    });

  let slice = session.messages.slice(-SYNC_MAX_MESSAGES);
  let messages = build(slice);
  // 超出服务端体积上限时丢最旧的几条，避免整段记录一直同步失败
  while (slice.length > 1 && JSON.stringify(messages).length > 900_000) {
    slice = slice.slice(1);
    messages = build(slice);
  }
  return { title: session.title || "未命名聊天", updatedAt: session.updatedAt || Date.now(), messages };
}

function pushConversation(session) {
  return conversationFetch(`/${encodeURIComponent(session.id)}`, {
    method: "PUT",
    body: JSON.stringify(syncedPayload(session)),
  });
}

function deleteConversation(id) {
  return conversationFetch(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

function markConversationDeleted(id) {
  if (!id) return;
  state.deleted[id] = Date.now();
  state.deleted = pruneTombstones(state.deleted);
  saveState({ deletedConversations: state.deleted }).catch(() => {});
  syncedVersions.delete(id);
  if (state.user) deleteConversation(id).catch(() => {});
}

function pruneTombstones(map) {
  const now = Date.now();
  const kept = {};
  for (const [id, at] of Object.entries(map || {})) {
    if (now - at < TOMBSTONE_TTL) kept[id] = at;
  }
  return kept;
}

async function flushTombstones() {
  const ids = Object.keys(state.deleted);
  if (!ids.length) return;
  for (const id of ids) {
    try {
      await deleteConversation(id);
      delete state.deleted[id];
    } catch {
      // 网络失败时保留墓碑，下次再试
    }
  }
  await saveState({ deletedConversations: state.deleted });
}

function scheduleConversationPush() {
  if (!state.user || !state.token) return;
  clearTimeout(historyPushTimer);
  historyPushTimer = setTimeout(() => {
    pushLocalConversations().catch(() => {});
  }, 700);
}

async function pushLocalConversations() {
  if (!state.user || !state.token || syncRunning) return;

  for (const session of state.sessions) {
    if (!session.messages.length) continue;
    if (syncedVersions.get(session.id) === session.updatedAt) continue;
    try {
      await pushConversation(session);
      syncedVersions.set(session.id, session.updatedAt);
    } catch {
      // 网络恢复后下一次保存会重试
    }
  }
}

async function syncConversations({ upload = true } = {}) {
  if (!state.user || !state.token) return false;
  if (syncRunning) return syncRunning;

  syncRunning = (async () => {
    const owner = (state.user.email || "").toLowerCase();
    await flushTombstones();

    let remote;
    try {
      remote = await conversationFetch("");
    } catch {
      return false;
    }

    if (state.historyOwner && state.historyOwner !== owner) {
      // 换了账号：上一账号留在本机的记录不并入新账号
      state.sessions = [];
      state.activeId = "";
    }
    syncedVersions.clear();

    remote = remote.filter((item) => !state.deleted[item.clientId]);
    if (remote.length) {
      // 刚打开面板时自动建的空聊天没有内容，恢复历史时不必保留
      state.sessions = state.sessions.filter((session) => session.messages.length);
    }
    const remoteById = new Map(remote.map((item) => [item.clientId, item]));
    const localById = new Map(state.sessions.map((session) => [session.id, session]));

    for (const item of remote) {
      syncedVersions.set(item.clientId, item.clientUpdatedAt || 0);
      const local = localById.get(item.clientId);
      if (local && (local.updatedAt || 0) >= (item.clientUpdatedAt || 0)) continue;

      try {
        const full = await conversationFetch(`/${encodeURIComponent(item.clientId)}`);
        const restored = {
          id: item.clientId,
          title: full.title || "未命名聊天",
          updatedAt: full.clientUpdatedAt || Date.now(),
          messages: Array.isArray(full.messages) ? full.messages : [],
        };
        if (local) Object.assign(local, restored);
        else state.sessions.push(restored);
      } catch {
        // 单条失败不影响其他会话
      }
    }

    if (upload) {
      for (const session of state.sessions) {
        if (!session.messages.length) continue;
        const remoteItem = remoteById.get(session.id);
        if (remoteItem && (session.updatedAt || 0) <= (remoteItem.clientUpdatedAt || 0)) continue;
        try {
          await pushConversation(session);
          syncedVersions.set(session.id, session.updatedAt);
        } catch {
          // 下次保存重试
        }
      }
    }

    state.historyOwner = owner;
    state.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (state.sessions.length > MAX_SESSIONS) state.sessions = state.sessions.slice(0, MAX_SESSIONS);
    if (!state.sessions.some((session) => session.id === state.activeId)) {
      state.activeId = state.sessions[0]?.id || "";
    }
    await saveState({
      historyOwner: owner,
      sessions: state.sessions,
      activeSession: state.activeId,
    });
    renderThread();
    renderHistory();
    return true;
  })().finally(() => {
    syncRunning = null;
  });

  return syncRunning;
}

async function registerDevice() {
  clearTimeout(historyPushTimer);
  historyPushTimer = 0;
  syncedVersions.clear();
  const response = await fetch(`${state.server}/api/device/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: state.deviceId, label: state.label || "Edge 扩展" }),
  });
  const data = await readJson(response);
  state.token = data.token;
  state.balance = data.balance;
  state.user = null;
  state.accountDeviceId = data.deviceId || "";
  await saveState({ token: data.token, user: null });
  renderBalance();
  renderAccountCard();
}

async function loadConfig() {
  const config = await refreshConfig();
  setStatus(config.chatEnabled ? "已连接" : "服务已暂停", config.chatEnabled ? "" : "error");
}

// 面板重新显示时顺带刷新一次，避免长时间挂着看到旧模型
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - configFetchedAt < 30_000) return;
  refreshConfig().catch(() => {});
});

function renderModels() {
  const models = state.config?.models || [];
  els.modelMenu.textContent = "";
  els.modelMenu.hidden = true;
  els.modelButton.setAttribute("aria-expanded", "false");

  if (!models.length) {
    els.modelButton.disabled = true;
    els.modelName.textContent = "后台未启用任何模型";
    els.modelLogo.innerHTML = logoMarkup(null);
    els.modelButton.dataset.tip = "后台未启用任何模型";
    return;
  }

  els.modelButton.disabled = false;
  const selected = currentModel() || models[0];
  els.modelLogo.innerHTML = logoMarkup(selected);
  els.modelName.textContent = selected.displayName;
  els.modelButton.dataset.tip = modelTip(selected);

  for (const group of groupModelsByCategory(models)) {
    const header = document.createElement("div");
    header.className = "model-group";
    header.setAttribute("role", "presentation");
    header.textContent = group.name;
    els.modelMenu.append(header);

    for (const model of group.models) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "model-option";
      option.dataset.model = model.modelId;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(model.modelId === state.model));

      const logo = document.createElement("span");
      logo.className = "model-logo";
      logo.setAttribute("aria-hidden", "true");
      logo.innerHTML = logoMarkup(model);

      const name = document.createElement("span");
      name.className = "model-name";
      name.textContent = model.displayName;

      option.append(logo, name);
      els.modelMenu.append(option);
    }
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
  const user = state.user;
  els.popDevice.textContent = user ? (user.displayName || user.email) : (state.label || "本机设备");
  els.popDevice.title = user ? user.email : "";
  const authLabel = user ? "退出登录" : "登录 / 注册";
  els.popAuthLabel.textContent = authLabel;
  els.popAuth.dataset.pop = "auth";
  els.popAuthIcon.innerHTML = iconSvg(user ? "logout" : "user");
  els.popVersion.textContent = `v${chrome.runtime.getManifest().version}`;
  els.rechargeDevice.value = state.accountDeviceId || state.deviceId || "";
}

function syncBusy() {
  els.send.disabled = state.busy;
  els.stop.hidden = !state.busy;
  els.btnAdd.disabled = state.busy;
  if (state.busy) {
    closeAddMenu();
    closeModelMenu();
  }
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
  state.accountDeviceId = data.deviceId || state.accountDeviceId;
  renderBalance();
  renderAccountCard();
  return data;
}

// ---------- 视图切换 ----------

function showView(name, { focusInput = false } = {}) {
  state.view = name;
  closeAddMenu();
  closeModelMenu();
  for (const button of document.querySelectorAll('#rail button[data-view], #navGrid button[data-view]')) {
    button.classList.toggle("active", button.dataset.view === name);
  }
  els.chatView.hidden = name !== "chat";
  els.askView.hidden = name !== "ask";
  els.translateView.hidden = name !== "translate";
  els.toolsView.hidden = name !== "tools";
  els.settingsView.hidden = name !== "settings";

  if (name === "settings") fillSettings();
  if (name === "translate") renderTranslatePane();
  if (name === "chat" && focusInput) els.input.focus();
}

// ---------- 折叠与全页模式：仿 Sider 面板右上角那一对按钮 ----------

function setCollapsed(collapsed, { persist = true } = {}) {
  state.collapsed = collapsed;
  closeNavMenu();
  els.layout.classList.toggle("collapsed", collapsed);
  const name = collapsed ? "unfold" : "fold";
  const tip = collapsed ? "展开面板" : "折叠面板";
  els.railFold.dataset.icon = name;
  els.railFold.dataset.tip = tip;
  els.railFold.setAttribute("aria-label", tip);
  els.railFold.setAttribute("aria-pressed", String(collapsed));
  els.railFold.innerHTML = iconSvg(name);
  if (persist) chrome.storage.local.set({ panelCollapsed: collapsed });
}

function openFullPage() {
  return chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/sidepanel.html?full=1") });
}

// ---------- 折叠态的汉堡导航卡片 ----------

function openNavMenu() {
  els.navMenu.hidden = false;
  els.navToggle.setAttribute("aria-expanded", "true");
}

function closeNavMenu() {
  if (els.navMenu.hidden) return;
  els.navMenu.hidden = true;
  els.navToggle.setAttribute("aria-expanded", "false");
}

function toggleNavMenu() {
  if (els.navMenu.hidden) openNavMenu();
  else closeNavMenu();
}

async function pickView(name) {
  closeNavMenu();
  showView(name);
  if (name === "translate" || name === "chat") await syncSelection();
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

const isWebTab = (tab) => Boolean(tab) && /^https?:/i.test(tab.url || "");

// 没有内容脚本的标签上 sendMessage 可能一直挂起，必须限时
const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return isWebTab(tab) ? tab : null;
}

async function extractPage() {
  const tab = await activeTab();
  if (!tab) {
    const { data, blocked } = await probeWebTab();
    if (data) {
      state.pageCache = { ...data, at: Date.now() };
      return state.pageCache;
    }
    if (blocked) throw new UiError("读不到网页正文：当前标签可能不是普通网页，或扩展没有该网站的访问权限（edge://extensions → 站点访问权限）");
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active && !active.url) {
      throw new UiError("读不到当前网页：请在 edge://extensions → SP AI助手 → 站点访问权限里允许该网站");
    }
    throw new UiError("请先切到要读取的网页标签页（扩展页面无法读取）");
  }
  if (state.pageCache && state.pageCache.url === tab.url && Date.now() - state.pageCache.at < 60_000) {
    return state.pageCache;
  }

  let payload = null;
  try {
    payload = await withTimeout(chrome.tabs.sendMessage(tab.id, { type: "extract" }), 2000);
  } catch {
    payload = await withTimeout(injectExtract(tab.id), 3000);
  }
  if (!payload?.text) throw new UiError("这个页面没能提取到正文，可能是浏览器内置页面或内容为空");

  state.pageCache = { ...payload, at: Date.now() };
  return state.pageCache;
}

// 全页模式下当前标签就是扩展页面：按最近访问挑网页标签试读
async function probeWebTab() {
  let self = null;
  try {
    self = await chrome.tabs.getCurrent();
  } catch {
    // 侧边栏不是标签页，没有 self
  }
  if (!self) return { data: null, blocked: false };
  // 全页模式可能落在另一个窗口，按全局最近访问排序
  const candidates = (await chrome.tabs.query({}))
    .filter((t) => t.id !== self.id && !t.discarded && !/^(chrome-extension|extension):/i.test(t.url || ""))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const candidate = candidates[0];
  if (!candidate) return { data: null, blocked: false };
  try {
    const data = await withTimeout(chrome.tabs.sendMessage(candidate.id, { type: "extract" }), 2000);
    if (data?.text) return { data, blocked: false };
  } catch {
    // 内容脚本没就绪，改用注入
  }
  try {
    const data = await withTimeout(injectExtract(candidate.id), 3000);
    if (data?.text) return { data, blocked: false };
  } catch {
    return { data: null, blocked: true };
  }
  return { data: null, blocked: false };
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
  resetCaps();
  renderThread();
  await saveSessions();
  showView("chat", { focusInput: true });
  setStatus("已新建聊天");
}

function renderHistorySyncTip() {
  if (!els.historySync) return;
  if (!state.user) {
    els.historySync.textContent = "未登录：聊天记录只保存在本机，登录同一账号后可在其他设备恢复。";
    return;
  }
  const owner = (state.user.email || "").toLowerCase();
  const stale = state.historyOwner && state.historyOwner !== owner;
  els.historySync.textContent = stale
    ? "正在切换到该账号的聊天记录…"
    : `已登录 ${state.user.email}，聊天记录会同步到云端，换设备登录同一账号即可恢复。`;
}

function renderHistory() {
  renderHistorySyncTip();
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
      resetCaps();
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
      markConversationDeleted(session.id);
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

function openHistoryDialog({ sync = true } = {}) {
  renderHistory();
  if (!els.historyDialog.open) els.historyDialog.showModal();
  if (!sync || !state.user) return;
  syncConversations({ upload: false })
    .then((ok) => {
      if (ok) renderHistory();
    })
    .catch(() => {});
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
  const goal = (session.goal || "").trim();
  const apiContent = goal ? `【对话目标】${goal}\n\n${content}` : content;
  const apiMessages = [...history, { role: "user", content: apiContent, images }];

  const userMessage = { role: "user", content: label, prompt: apiContent, note, images: images.length, at: Date.now() };
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

  const label = extra.label || (question && template.includes("{{question}}")
    ? question
    : `${action.label}${selection ? `：${clip(selection, 60)}` : ""}`);
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

els.railFold.addEventListener("click", () => setCollapsed(!state.collapsed));

els.railFull.addEventListener("click", () => {
  openFullPage().catch(() => setStatus("打开全页失败", "error"));
});

els.navToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleNavMenu();
});

// 汉堡卡片：顶部两个图标负责回功能栏 / 全页，网格切视图，底部是新聊天、历史、账户
els.navExpand.addEventListener("click", () => {
  setCollapsed(false);
  closeNavMenu();
});

els.navFull.addEventListener("click", () => {
  closeNavMenu();
  openFullPage().catch(() => setStatus("打开全页失败", "error"));
});

els.navNew.addEventListener("click", () => {
  closeNavMenu();
  newChat().catch(showError);
});

els.navHistory.addEventListener("click", () => {
  closeNavMenu();
  openHistoryDialog();
});

els.navAvatar.addEventListener("click", () => {
  closeNavMenu();
  openCreditsDialog().catch(showError);
});

els.navGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (button) pickView(button.dataset.view).catch(showError);
});

els.rail.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  pickView(button.dataset.view).catch(showError);
});

els.modelButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleModelMenu();
});

els.modelMenu.addEventListener("click", (event) => {
  event.stopPropagation();
  const option = event.target.closest(".model-option");
  if (option) selectModel(option.dataset.model).catch(showError);
});

els.modelMenu.addEventListener("keydown", (event) => {
  const options = [...els.modelMenu.querySelectorAll(".model-option")];
  const index = options.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = index < 0 ? options[0] : options[(index + delta + options.length) % options.length];
    next?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    const option = document.activeElement.closest(".model-option");
    if (option) selectModel(option.dataset.model).catch(showError);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    closeModelMenu(true);
  }
});

els.btnReadPage.addEventListener("click", () => {
  setReadPage(!state.readPage);
  setStatus(state.readPage ? "发送时会带上本页正文" : "已取消带上本页");
});

els.btnAdd.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleAddMenu();
});

els.addMenu.addEventListener("click", (event) => {
  // 选项重渲染后旧节点已脱离文档，靠冒泡到 document 判断“点在外面”会误关菜单
  event.stopPropagation();
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    state.menuTab = tab.dataset.tab;
    renderAddMenu();
    return;
  }
  if (event.target.closest("#goalSave")) {
    const input = els.menuBody.querySelector("#goalInput");
    const text = input?.value.trim() || "";
    if (!text) {
      input?.focus();
      return;
    }
    setGoal(text);
    closeAddMenu();
    setStatus("已设置对话目标");
    return;
  }
  if (event.target.closest("#goalClear")) {
    setGoal("");
    renderAddMenu();
    setStatus("已清除对话目标");
  }
});

function handleGoalKey(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    els.menuBody.querySelector("#goalSave")?.click();
  }
}

els.addMenu.addEventListener("keydown", (event) => {
  if (event.target.id === "goalInput") handleGoalKey(event);
});

document.addEventListener("click", (event) => {
  if (!els.addMenu.contains(event.target) && !els.btnAdd.contains(event.target)) closeAddMenu();
  if (!els.modelPicker.contains(event.target)) closeModelMenu();
  if (!els.navMenu.contains(event.target) && !els.navToggle.contains(event.target)) closeNavMenu();
});

window.addEventListener("resize", () => {
  if (!els.addMenu.hidden) positionAddMenu();
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
  const plugins = state.caps.plugins;

  if (plugins.includes("shot")) {
    try {
      await captureScreenshot();
    } catch (err) {
      showError(err);
    }
  }

  const images = state.attachments.filter((a) => a.kind === "image").map((a) => a.dataUrl);
  const files = state.attachments.filter((a) => a.kind === "text");
  if (!question && !images.length && !files.length) {
    els.input.focus();
    return;
  }

  const extras = [];
  if (state.caps.plan) extras.push("【计划模式】请先给出分步计划，再按计划逐步执行。");
  for (const skill of selectedCaps("skill")) extras.push(`【技能·${skill.name}】${skill.prompt}`);
  if (plugins.includes("selection")) {
    const selection = await syncSelection().catch(() => "");
    if (selection) extras.push(`【选中文字】\n${selection}`);
    else setStatus("没有选中网页文字，已跳过划选插件", "error");
  }

  const fileBlock = files.map((f) => `【文件 ${f.name}】\n${f.text}`).join("\n\n");
  const content = [...extras, question, fileBlock].filter(Boolean).join("\n\n");
  const label = question || (images.length ? `看图 ${images.length} 张` : `附加 ${files.length} 个文件`);
  const note = [files.length ? `附加 ${files.length} 个文件` : "", capsNote()].filter(Boolean).join(" · ");
  const readPage = state.readPage || plugins.includes("page");

  if (images.length && !currentModel()?.supportsVision) {
    await ask({ label, content, images, note }); // 由 ask 统一提示换模型，附件保留在输入条
    return;
  }

  clearAttachments();
  els.input.value = "";
  resetCaps();

  if (readPage) {
    await runAction("qa_page", { question: content, images, note, label: label || "问这篇网页" });
    return;
  }
  await ask({ label, content, images, note });
}

els.stop.addEventListener("click", () => state.controller?.abort());

els.newChat.addEventListener("click", () => newChat().catch(showError));

els.openHistory.addEventListener("click", () => openHistoryDialog());

els.clearHistory.addEventListener("click", async () => {
  if (state.sessions.length) {
    state.sessions.forEach((item) => markConversationDeleted(item.id));
  }
  state.sessions = state.sessions.filter((item) => item.id === state.activeId);
  const current = activeSession();
  current.messages = [];
  current.title = "新聊天";
  current.updatedAt = Date.now();
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
  else if (item.dataset.pop === "history") openHistoryDialog();
  else if (item.dataset.pop === "settings") showView("settings");
  else if (item.dataset.pop === "auth") {
    if (state.user) logoutAccount().catch(showError);
    else openAuthDialog("login");
  }
});

els.popRecharge.addEventListener("click", () => {
  closeAccountPop();
  openCreditsDialog().catch(showError);
});

document.addEventListener("click", (event) => {
  if (!els.avatarDock.contains(event.target)) closeAccountPop();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAccountPop();
    closeAddMenu();
    closeModelMenu();
    closeNavMenu();
  }
});

els.refreshCredits.addEventListener("click", loadCreditsList);
els.closeCredits.addEventListener("click", () => els.creditsDialog.close());

// ---------- 用户账号：登录 / 注册 / 退出 ----------

let authCodeTimer = 0;
let authCodeLeft = 0;

function resetCodeButton() {
  clearInterval(authCodeTimer);
  authCodeTimer = 0;
  authCodeLeft = 0;
  els.authSendCode.disabled = false;
  els.authSendCode.textContent = "发送验证码";
}

function startCodeCountdown(seconds) {
  clearInterval(authCodeTimer);
  authCodeLeft = Math.max(1, seconds);
  els.authSendCode.disabled = true;
  els.authSendCode.textContent = `重新发送(${authCodeLeft})`;
  authCodeTimer = setInterval(() => {
    authCodeLeft -= 1;
    if (authCodeLeft <= 0) {
      resetCodeButton();
      return;
    }
    els.authSendCode.textContent = `重新发送(${authCodeLeft})`;
  }, 1000);
}

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === "register";
  els.authTitle.textContent = register ? "注册账号" : "登录账号";
  els.authSubmit.textContent = register ? "注册并登录" : "登录";
  els.authNameRow.hidden = !register;
  els.authCodeRow.hidden = !register;
  els.authPassword.autocomplete = register ? "new-password" : "current-password";
  els.authTip.textContent = register
    ? "注册需要邮箱验证码，验证通过后新用户积分归账号所有，本机剩余积分也会并入。"
    : "登录后积分、充值记录和聊天记录跟随账号，换设备登录同一账号即可继续使用。";
  els.authError.hidden = true;
  resetCodeButton();
  for (const tab of els.authDialog.querySelectorAll("[data-auth-tab]")) {
    tab.classList.toggle("active", tab.dataset.authTab === mode);
  }
}

function openAuthDialog(mode = "login") {
  closeAccountPop();
  setAuthMode(mode);
  els.authEmail.value = "";
  els.authName.value = "";
  els.authPassword.value = "";
  els.authCode.value = "";
  els.authSubmit.disabled = false;
  els.authDialog.showModal();
  setTimeout(() => els.authEmail.focus(), 0);
}

function showAuthError(text) {
  els.authError.textContent = text;
  els.authError.hidden = false;
}

async function sendEmailCode() {
  const email = els.authEmail.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return showAuthError("请先填写有效的邮箱地址");
  }
  els.authError.hidden = true;
  els.authSendCode.disabled = true;
  try {
    const response = await fetch(`${state.server}/api/auth/email-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await readJson(response);
    const minutes = Math.max(1, Math.round((data.expiresIn || 600) / 60));
    if (data.devCode) {
      els.authCode.value = data.devCode;
      setStatus(`验证码已生成（开发模式：${data.devCode}），${minutes} 分钟内有效`);
    } else {
      setStatus(`验证码已发送，请查收邮件（含垃圾箱），${minutes} 分钟内有效`);
    }
    startCodeCountdown(60);
  } catch (err) {
    els.authSendCode.disabled = false;
    if (err instanceof TypeError) showAuthError(`连不上服务器：${state.server}`);
    else showAuthError(err.message || "发送失败，请重试");
  }
}

async function submitAuth() {
  const register = state.authMode === "register";
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const code = els.authCode.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showAuthError("请输入有效的邮箱地址");
  if (password.length < 8) return showAuthError("密码至少 8 位");
  if (register && !/^\d{6}$/.test(code)) return showAuthError("请输入 6 位邮箱验证码");

  els.authError.hidden = true;
  els.authSubmit.disabled = true;
  try {
    const response = await fetch(`${state.server}/api/auth/${register ? "register" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        code: register ? code : "",
        displayName: register ? els.authName.value.trim() : "",
        deviceId: state.deviceId,
        label: state.label || "Edge 扩展",
      }),
    });
    const data = await readJson(response);
    state.token = data.token;
    state.user = data.user?.email ? data.user : { email, displayName: email.split("@")[0] };
    state.accountDeviceId = data.accountDeviceId || "";
    state.balance = data.balance;
    await saveState({ token: state.token, user: state.user });
    els.authDialog.close();
    resetCodeButton();
    renderBalance();
    renderAccountCard();
    refreshCredits().catch(() => {});
    const synced = await syncConversations().catch(() => false);
    const gift = register && data.giftCredits > 0 ? `，已赠送 ${data.giftCredits} 积分` : "";
    const merged = data.mergedCredits > 0 ? `，已合并本机 ${data.mergedCredits} 积分` : "";
    setStatus(`${register ? "注册成功" : "已登录"}${gift}${merged}${synced ? "，聊天记录已同步" : ""}`);
  } catch (err) {
    els.authSubmit.disabled = false;
    if (err instanceof TypeError) showAuthError(`连不上服务器：${state.server}`);
    else showAuthError(err.message || "操作失败，请重试");
  }
}

async function logoutAccount() {
  closeAccountPop();
  clearTimeout(historyPushTimer);
  historyPushTimer = 0;
  syncedVersions.clear();
  try {
    const response = await fetch(`${state.server}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const data = await readJson(response);
    state.token = data.token;
    state.user = null;
    state.accountDeviceId = data.accountDeviceId || "";
    state.balance = data.balance;
    await saveState({ token: state.token, user: null });
    renderBalance();
    renderAccountCard();
    setStatus("已退出登录");
  } catch (err) {
    showError(err);
  }
}

async function loadMe() {
  if (!state.token) return;
  const response = await fetch(`${state.server}/api/auth/me`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  const data = await readJson(response);
  state.user = data.loggedIn ? { email: data.email, displayName: data.displayName } : null;
  state.accountDeviceId = data.accountDeviceId || "";
  state.balance = data.balance;
  await saveState({ user: state.user });
  renderBalance();
  renderAccountCard();
}

els.authDialog.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-auth-tab]");
  if (tab) setAuthMode(tab.dataset.authTab);
});
els.authSubmit.addEventListener("click", () => submitAuth());
els.authSendCode.addEventListener("click", () => sendEmailCode());
els.authCancel.addEventListener("click", () => els.authDialog.close());
els.authDialog.addEventListener("close", resetCodeButton);
els.authDialog.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.tagName === "INPUT") {
    event.preventDefault();
    submitAuth();
  }
});

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
  if (server !== oldServer) {
    // 换服务器后旧令牌无效，账号态一起清掉，重新走匿名注册；删除标记只对旧服务器有效
    state.token = "";
    state.user = null;
    state.accountDeviceId = "";
    state.deleted = {};
    clearTimeout(historyPushTimer);
    historyPushTimer = 0;
    syncedVersions.clear();
  }
  await saveState({
    server,
    label: state.label,
    token: state.token,
    user: state.user,
    deletedConversations: state.deleted,
  });
  const ok = await boot();
  if (ok) setStatus("已保存设置");
});

els.reregister.addEventListener("click", async () => {
  try {
    const wasUser = !!state.user;
    await registerDevice();
    fillSettings();
    setStatus(wasUser ? "已重新注册，账号已退出" : "已重新注册");
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

// 全页标签页里没有“折叠”这回事，只有面板恢复上次的折叠状态
if (!FULL_PAGE) {
  chrome.storage.local.get("panelCollapsed").then((saved) => {
    if (saved.panelCollapsed) setCollapsed(true, { persist: false });
  });
}

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
    await loadMe().catch(() => {});
    if (state.user) await syncConversations().catch(() => false);
    await loadConfig();
    activeSession();
    renderThread();
    renderAttachments();
    renderPicks();
    await saveSessions();
    showView(state.view);
    await consumePending();
    return true;
  } catch (err) {
    showError(err);
    if (!(err instanceof TypeError)) setStatus(err.message || "后端未就绪", "error");
    return false;
  } finally {
    renderAccountCard();
    syncBusy();
  }
}
// 首帧就同步导航高亮，不依赖 boot 的后端请求成功
showView(state.view);
boot();
