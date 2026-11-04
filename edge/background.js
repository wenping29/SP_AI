const MENU_ACTIONS = [
  { id: "summarize", title: "SP：总结本页", contexts: ["page", "selection"] },
  { id: "outline", title: "SP：列大纲", contexts: ["page", "selection"] },
  { id: "translate", title: "SP：译成中文", contexts: ["selection"] },
  { id: "explain", title: "SP：解释划线", contexts: ["selection"] },
  { id: "polish", title: "SP：润色改写", contexts: ["selection"] },
];

chrome.runtime.onInstalled.addListener(() => {
  enablePanelBehavior();
  registerMenus();
});

chrome.runtime.onStartup.addListener(enablePanelBehavior);

function enablePanelBehavior() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

function registerMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const item of MENU_ACTIONS) {
      chrome.contextMenus.create({ id: item.id, title: item.title, contexts: item.contexts });
    }
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  launchAction({ actionId: info.menuItemId, selection: info.selectionText || "", tab });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "sp-action" || msg?.type === "sp-launch") {
    launchAction({
      actionId: msg.actionId,
      view: msg.view,
      selection: msg.selection,
      tab: sender.tab,
    })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});

// 划词/悬浮按钮：打开停靠侧边栏必须在丢手势之前调用，所以 open() 是第一个 await。
async function launchAction({ actionId, view, selection, tab }) {
  const windowId = tab?.windowId;
  if (typeof windowId !== 'number') return;

  const pending = {
    actionId: actionId || null,
    view: view || null,
    selection: (selection || "").trim(),
    title: tab?.title || "",
    url: tab?.url || "",
    windowId,
    at: Date.now(),
  };
  const written = chrome.storage.local.set({ pending });
  try {
    await chrome.sidePanel.open({ windowId });
  } catch (err) {
    console.warn("打开侧边栏失败", err?.message || err);
  }
  await written;
  try {
    await chrome.runtime.sendMessage({ type: "pending-ready" });
  } catch (err) {
    // 面板还没起来，下一步它会自己读 pending
    console.warn("通知面板失败", err?.message || err);
  }
}
