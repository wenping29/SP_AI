// 离线仿真回归：不依赖浏览器，验证框选交互、重复注入兜底与截图裁剪换算
// 用法：node verify-crop-sim.mjs
import fs from "node:fs/promises";
import vm from "node:vm";

const read = (file) => fs.readFile(new URL(file, import.meta.url), "utf8");
const cropSrc = await read("../edge/content/crop.js");
const panelSrc = await read("../edge/sidepanel/sidepanel.js");
const results = {};
const messages = [];
const listeners = {};
const dispatched = [];

function makeEl() {
  return {
    id: "", style: {}, textContent: "", removed: false, _q: {}, _children: [],
    classList: {
      _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    querySelector(sel) { return this._q[sel] || (this._q[sel] = makeEl()); },
    addEventListener() {}, remove() { this.removed = true; },
    append(child) { this._children.push(child); return child; },
    attachShadow() { this.shadow = makeEl(); return this.shadow; },
  };
}

function makeWindow() {
  return {
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 2,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); },
    // 所有实例共用一份监听器，模拟同一个页面上的多个注入脚本
    dispatchEvent(event) {
      dispatched.push(event.type);
      for (const fn of [...(listeners[event.type] || [])]) fn(event);
    },
  };
}

const doc = {
  documentElement: makeEl(),
  getElementById() { return null; },
  createElement() { return makeEl(); },
};
const base = {
  document: doc, location: { href: "https://example.com/page" },
  chrome: { runtime: { sendMessage: (msg) => { messages.push(msg); return Promise.resolve(); } } },
  setTimeout: () => 1, clearTimeout: () => {}, console,
  CustomEvent: class { constructor(type) { this.type = type; } },
  UiError: Error,
};

function runCrop(win) {
  const ctx = { ...base, window: win };
  vm.createContext(ctx);
  vm.runInContext(cropSrc, ctx);
  return ctx;
}

const fire = (name, props = {}) => {
  const event = {
    button: 0, clientX: 0, clientY: 0, key: "", composedPath: () => [],
    preventDefault() {}, stopPropagation() {}, ...props,
  };
  for (const fn of [...(listeners[name] || [])]) fn(event);
};
const hosts = () => doc.documentElement._children;

// 1. 注入即进入框选，太小的拖拽不产生结果
runCrop(makeWindow());
results.overlayCreatedOnInject = hosts().length === 1 && hosts()[0].id === "sp-area-crop-host";
fire("mousedown", { clientX: 10, clientY: 10 });
fire("mousemove", { clientX: 12, clientY: 12 });
fire("mouseup", { clientX: 12, clientY: 12 });
results.tinyDragIgnored = messages.length === 0 && !hosts()[0].removed;

// 2. 正常框选 -> 遮罩先移除，再回传选区（含 DPR / 视口）
fire("mousedown", { clientX: 100, clientY: 120 });
fire("mousemove", { clientX: 400, clientY: 300 });
fire("mouseup", { clientX: 400, clientY: 300 });
const done = messages.find((m) => m.type === "sp-crop-done");
results.rectOk = JSON.stringify(done?.payload?.rect) === JSON.stringify({ x: 100, y: 120, w: 300, h: 180 });
results.viewportOk = done?.payload?.viewport?.width === 1200 && done?.payload?.viewport?.height === 800 && done?.payload?.dpr === 2;
results.overlayRemovedBeforeResult = hosts()[0].removed === true;
results.listenersCleaned = (listeners.mousedown || []).length === 0;

// 3. 二次注入（同一页面、不共享全局变量）：广播 abort 收掉旧实例，只留一层框选
runCrop(makeWindow());
runCrop(makeWindow());
results.abortBroadcast = dispatched.includes("sp-area-crop-abort");
results.singleActiveOverlay = (listeners.mousedown || []).length === 1;
fire("keydown", { key: "Escape" });
results.escapeCancels = messages.at(-1)?.type === "sp-crop-cancel";

// 4. 侧边栏裁剪换算：DPR=2 时整屏截图 2400x1600，选 300x180 应得到 600x360
const from = panelSrc.indexOf("async function cropShot(");
const to = panelSrc.indexOf("async function captureScreenshot(", from);
if (from < 0 || to < 0) throw new Error("找不到 cropShot 源码");
let drawArgs = null;
let canvasEl = null;
class FakeImage {
  constructor() { this.complete = true; this.naturalWidth = 2400; this.naturalHeight = 1600; }
  set src(_value) {}
}
const shotCtx = {
  ...base,
  Image: FakeImage,
  document: {
    ...doc,
    createElement(tag) {
      if (tag !== "canvas") return makeEl();
      canvasEl = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: (...args) => { drawArgs = args; } }),
        toDataURL: () => "data:image/png;base64,cropped",
      };
      return canvasEl;
    },
  },
};
vm.createContext(shotCtx);
vm.runInContext(`${panelSrc.slice(from, to)}\nglobalThis.__cropShot = cropShot;`, shotCtx);
const dataUrl = await shotCtx.__cropShot("data:image/png;base64,full", {
  rect: { x: 100, y: 120, w: 300, h: 180 },
  viewport: { width: 1200, height: 800 }, dpr: 2,
});
results.cropOutputOk = dataUrl === "data:image/png;base64,cropped";
results.canvasSizeOk = canvasEl?.width === 600 && canvasEl?.height === 360;
results.drawArgsOk = JSON.stringify(drawArgs?.slice(1)) === JSON.stringify([200, 240, 600, 360, 0, 0, 600, 360]);

console.log(JSON.stringify(results, null, 2));
const failed = Object.entries(results).filter(([, value]) => value !== true);
if (failed.length) {
  console.error("FAILED:", failed.map(([key]) => key).join(", "));
  process.exitCode = 1;
} else {
  console.log("PASS: 框选交互、重复注入兜底与截图裁剪换算仿真通过");
}
