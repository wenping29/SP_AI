(async () => {
  const storageKeys = Object.keys(await chrome.storage.local.get(null));
  const pending = (await chrome.storage.local.get('pending')).pending || null;
  state.view = 'probe';
  els.chatView.hidden = false;
  const clicks = [];
  els.rail.addEventListener('click', (e) => clicks.push(e.target.textContent), true);
  await new Promise((r) => setTimeout(r, 3000));
  return {
    storageKeys,
    pending,
    viewAfterWait: state.view,
    clicks,
    activeRail: els.rail.querySelector('button.active')?.dataset.view,
    visible: ['chatView','askView','translateView','toolsView','settingsView'].filter((k) => !els[k].hidden),
    msgNodes: els.thread.querySelectorAll('.msg').length,
  };
})()
