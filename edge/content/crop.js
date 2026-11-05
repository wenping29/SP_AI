// 网页内框选截图：侧边栏通过 chrome.scripting.executeScript 注入，注入即进入框选模式。
// 选区坐标用 CSS 像素（clientX/clientY，相对视口），侧边栏拿到后按截图实际尺寸换算并裁剪。
// 遮罩必须在回传结果前移除，否则会被 captureVisibleTab 一起截进去。
(() => {
  const KEY = "__spAreaCrop";
  const HOST_ID = "sp-area-crop-host";
  const MIN_SIZE = 8;
  const IDLE_TIMEOUT = 120_000;
  // 扩展自己注入的悬浮 UI 不该出现在截图里
  const CHROME_UI_IDS = ["sp-selection-bar", "sp-launcher-rail"];

  if (window[KEY] && typeof window[KEY].start === "function") {
    window[KEY].start();
    return;
  }

  let host = null;
  let box = null;
  let sizeLabel = null;
  let active = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let rect = null;
  let idleTimer = 0;
  let restoreTimer = 0;
  let hiddenUi = [];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const inTip = (event) =>
    event.composedPath().some((node) => node?.classList?.contains?.("tip"));

  function build() {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "all:unset;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .box { position:fixed; display:none; border:1px solid #7b3fe4; pointer-events:none;
               box-shadow:0 0 0 9999px rgba(12,16,24,.45), inset 0 0 0 1px rgba(255,255,255,.65); }
        .box.show { display:block; }
        .size { position:absolute; left:-1px; top:-27px; padding:5px 8px; border-radius:6px;
                background:#1f232b; color:#fff; white-space:nowrap;
                font:12px/1 -apple-system, "Microsoft YaHei", sans-serif; }
        .tip { position:fixed; left:50%; top:18px; transform:translateX(-50%); display:flex;
               align-items:center; gap:10px; padding:9px 12px; border-radius:10px;
               background:#1f232b; color:#eef1f6; box-shadow:0 6px 20px rgba(0,0,0,.3);
               white-space:nowrap; font:13px/1.3 -apple-system, "Microsoft YaHei", sans-serif; }
        .tip button { border:0; border-radius:6px; padding:5px 9px; cursor:pointer;
                      background:#3a4150; color:#eef1f6; font:inherit; }
        .tip button:hover { background:#4b5466; }
      </style>
      <div class="box"><span class="size"></span></div>
      <div class="tip"><span>拖拽框选要截取的区域 · Esc 取消</span><button type="button">取消</button></div>`;
    box = shadow.querySelector(".box");
    sizeLabel = shadow.querySelector(".size");
    shadow.querySelector(".tip button").addEventListener("click", (event) => {
      event.stopPropagation();
      cancel();
    });
    document.documentElement.append(host);
  }

  function draw() {
    if (!rect || !box) return;
    box.classList.add("show");
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.w}px`;
    box.style.height = `${rect.h}px`;
    // 贴近视口顶部时把尺寸标签挪进框内，避免被浏览器边缘裁掉
    sizeLabel.style.top = rect.y < 32 ? "4px" : "-27px";
    sizeLabel.style.left = rect.y < 32 ? "4px" : "-1px";
    sizeLabel.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
  }

  function hideChromeUi() {
    hiddenUi = [];
    for (const id of CHROME_UI_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      hiddenUi.push({ el, previous: el.style.visibility });
      el.style.visibility = "hidden";
    }
  }

  function restoreChromeUi() {
    for (const item of hiddenUi) item.el.style.visibility = item.previous;
    hiddenUi = [];
  }

  function onPointerDown(event) {
    if (!active || event.button !== 0 || inTip(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    startX = clamp(event.clientX, 0, window.innerWidth);
    startY = clamp(event.clientY, 0, window.innerHeight);
    rect = { x: startX, y: startY, w: 0, h: 0 };
    draw();
  }

  function onPointerMove(event) {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    if (!dragging) return;
    const x = clamp(event.clientX, 0, window.innerWidth);
    const y = clamp(event.clientY, 0, window.innerHeight);
    rect = {
      x: Math.min(startX, x),
      y: Math.min(startY, y),
      w: Math.abs(x - startX),
      h: Math.abs(y - startY),
    };
    draw();
  }

  function onPointerUp(event) {
    if (!active || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = false;
    if (!rect || rect.w < MIN_SIZE || rect.h < MIN_SIZE) {
      rect = null;
      box?.classList.remove("show");
      return; // 误点或区域太小：继续等下一次拖拽
    }
    const payload = {
      rect: { ...rect },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio || 1,
      url: location.href,
    };
    finish(true);
    chrome.runtime.sendMessage({ type: "sp-crop-done", payload }).catch(() => {});
  }

  function onKeyDown(event) {
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    // 框选期间禁止页面滚动，否则视口坐标会和之后的截图对不上
    if ([" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onWheel(event) {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onContextMenu(event) {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  // 重复注入的兜底：若浏览器没有共享隔离环境的全局变量，旧实例也会收到并自行收尾
  function onAbort() {
    if (active) cancel(false);
  }

  const listeners = [
    ["mousedown", onPointerDown, true],
    ["mousemove", onPointerMove, true],
    ["mouseup", onPointerUp, true],
    ["keydown", onKeyDown, true],
    ["contextmenu", onContextMenu, true],
    ["wheel", onWheel, { capture: true, passive: false }],
    ["sp-area-crop-abort", onAbort, true],
  ];

  function addEvents() {
    for (const [name, fn, options] of listeners) window.addEventListener(name, fn, options);
  }

  function removeEvents() {
    for (const [name, fn, options] of listeners) window.removeEventListener(name, fn, options);
  }

  function finish(delayRestore = false) {
    active = false;
    dragging = false;
    clearTimeout(idleTimer);
    removeEvents();
    host?.remove();
    host = null;
    box = null;
    sizeLabel = null;
    clearTimeout(restoreTimer);
    if (delayRestore) {
      // 侧边栏收到消息后才会抓屏，晚一点恢复悬浮 UI，避免它们被截进图片
      restoreTimer = setTimeout(restoreChromeUi, 1500);
    } else {
      restoreChromeUi();
    }
  }

  function cancel(broadcast = true) {
    if (!active) return;
    finish(false);
    if (broadcast) chrome.runtime.sendMessage({ type: "sp-crop-cancel" }).catch(() => {});
  }

  function start() {
    clearTimeout(restoreTimer);
    restoreChromeUi();
    if (active) cancel(false); // 重新注入时静默收掉上一次框选，别误伤正在等待的面板
    document.getElementById(HOST_ID)?.remove();
    active = true;
    rect = null;
    dragging = false;
    hideChromeUi();
    build();
    addEvents();
    idleTimer = setTimeout(() => cancel(), IDLE_TIMEOUT);
  }

  window[KEY] = { start, cancel };
  // 在注册自己的监听之前广播，避免收到自己发出的事件
  window.dispatchEvent(new CustomEvent("sp-area-crop-abort"));
  start();
})();
