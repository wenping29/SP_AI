(() => {
  if (window.__spPageLoaded) return;
  window.__spPageLoaded = true;

  const TOOLBAR = [
    { id: "summarize", label: "总结" },
    { id: "translate", label: "翻译" },
    { id: "explain", label: "解释" },
    { id: "polish", label: "润色" },
  ];
  const MIN_CHARS = 4;
  const MAX_SELECTION = 6000;

  const host = document.createElement("div");
  host.style.cssText = "all:unset;position:fixed;z-index:2147483647;left:0;top:0;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .bar { display: none; gap: 2px; padding: 4px; border-radius: 8px;
             background: #2b2f36; box-shadow: 0 4px 14px rgba(0,0,0,.28);
             font: 12px/1 -apple-system, "Microsoft YaHei", sans-serif; position: absolute; }
      .bar.show { display: flex; }
      button { border: 0; padding: 6px 9px; border-radius: 6px; color: #f2f4f7;
               background: transparent; cursor: pointer; white-space: nowrap; }
      button:hover { background: #454b55; }
    </style>
    <div class="bar"></div>`;
  const bar = shadow.querySelector(".bar");

  for (const item of TOOLBAR) {
    const btn = document.createElement("button");
    btn.textContent = item.label;
    btn.addEventListener("mousedown", (event) => event.preventDefault());
    btn.addEventListener("click", () => {
      const selection = currentSelection();
      if (selection) chrome.runtime.sendMessage({ type: "sp-action", actionId: item.id, selection });
      hide();
    });
    bar.append(btn);
  }

  document.documentElement.append(host);

  // ---------- 右侧悬浮快捷栏（模仿 Monica）----------
  const LAUNCHER = [
    {
      key: "summarize",
      label: "总结全文",
      action: "summarize",
      icon: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    },
    {
      key: "translate",
      label: "划词翻译",
      view: "translate",
      icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z"/>',
    },
    {
      key: "tools",
      label: "全部工具",
      view: "tools",
      icon: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    },
    {
      key: "chat",
      label: "打开聊天",
      view: "chat",
      primary: true,
      icon: '<path d="M21 12a8.5 8.5 0 0 1-8.5 8.5c-1.3 0-2.5-.3-3.6-.9L4 21l1.4-4.9A8.5 8.5 0 1 1 21 12z"/><circle cx="9.5" cy="12" r="1"/><circle cx="14.5" cy="12" r="1"/>',
    },
  ];

  const railHost = document.createElement("div");
  railHost.style.cssText = "all:unset;position:fixed;z-index:2147483646;right:10px;top:50%;transform:translateY(-50%);";
  const railShadow = railHost.attachShadow({ mode: "open" });
  railShadow.innerHTML = `
    <style>
      .rail { display: flex; flex-direction: column; gap: 10px;
              font: 12px/1 -apple-system, "Microsoft YaHei", sans-serif; }
      .rail[hidden] { display: none; }
      button { width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%;
               display: flex; align-items: center; justify-content: center; cursor: pointer;
               position: relative;
               background: #1f232b; color: #eef1f6; box-shadow: 0 4px 14px rgba(0,0,0,.28);
               transition: transform .12s, background .12s; }
      button:hover { background: #2c323c; transform: scale(1.06); }
      button.primary { box-shadow: 0 0 0 2px #7b3fe4, 0 4px 14px rgba(0,0,0,.28); }
      /* 图标按钮的名称只在这里出现：贴左侧弹出，不用浏览器原生 title 的延迟 */
      button::after { content: attr(data-tip); position: absolute; right: calc(100% + 10px); top: 50%;
               transform: translateY(-50%); padding: 4px 8px; border-radius: 6px; background: rgba(34,38,44,.94);
               color: #fff; font-size: 12px; letter-spacing: 0; white-space: nowrap;
               opacity: 0; pointer-events: none; transition: opacity .08s; }
      button:hover::after { opacity: 1; }
      svg { width: 21px; height: 21px; }
    </style>
    <div class="rail"></div>`;
  const rail = railShadow.querySelector(".rail");
  for (const item of LAUNCHER) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.tip = item.label;
    btn.setAttribute("aria-label", item.label);
    if (item.primary) btn.classList.add("primary");
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>`;
    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "sp-launch", actionId: item.action || null, view: item.view || "chat" });
    });
    rail.append(btn);
  }
  if (window.top === window) document.documentElement.append(railHost);

  chrome.storage.local.get("launcher").then((saved) => {
    rail.hidden = saved.launcher === false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "launcher" in changes) rail.hidden = changes.launcher.newValue === false;
  });

  function currentSelection() {
    const text = String(window.getSelection() || "").trim();
    if (text.length < MIN_CHARS) return "";
    return text.length > MAX_SELECTION ? text.slice(0, MAX_SELECTION) : text;
  }

  function hide() {
    bar.classList.remove("show");
  }

  function sync() {
    const selection = window.getSelection();
    const text = currentSelection();
    if (!text || !selection.rangeCount) return hide();

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return hide();

    bar.classList.add("show");
    const width = bar.offsetWidth || 200;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, innerWidth - width - 8));
    const top = rect.top > 54 ? rect.top - 42 : rect.bottom + 10;
    bar.style.left = `${left}px`;
    bar.style.top = `${Math.max(8, top)}px`;
  }

  let timer = 0;
  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(sync, 120);
  });
  document.addEventListener("mouseup", () => {
    clearTimeout(timer);
    timer = setTimeout(sync, 60);
  });
  document.addEventListener("mousedown", (event) => {
    // host.contains() 不看穿 shadowRoot，会被判定成“点在浮层外面”而当场隐藏，按钮就点不中
    if (!event.composedPath().includes(host)) hide();
  }, true);
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("blur", hide);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "extract") {
      sendResponse(typeof spExtract === "function" ? spExtract() : { title: document.title, url: location.href, text: "" });
      return true;
    }
    if (msg?.type === "get-selection") {
      sendResponse({ selection: currentSelection() });
      return true;
    }
    return false;
  });
})();
