(() => ({
  readyState: document.readyState,
  hasExtract: typeof spExtract,
  pageLoadedFlag: window.__spPageLoaded,
  hostById: Boolean(document.getElementById('sp-selection-host')),
  documentElementChildren: [...document.documentElement.children].map((n) => n.tagName + (n.id ? '#' + n.id : '')),
  bodyChildren: [...document.body.children].map((n) => n.tagName + (n.id ? '#' + n.id : '') + '.' + n.className),
  extensionId: chrome.runtime.id,
}))();
