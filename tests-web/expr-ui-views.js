(() => {
  const out = { steps: [] };
  for (const name of ['ask', 'translate', 'tools', 'settings', 'chat']) {
    els.rail.querySelector(`button[data-view="${name}"]`).click();
    out.steps.push({
      name,
      title: els.viewTitle.textContent,
      activeRail: els.rail.querySelector('button.active')?.dataset.view,
      visible: ['chatView', 'askView', 'translateView', 'toolsView', 'settingsView'].filter((k) => !els[k].hidden),
    });
  }

  // 提问页：点一条模板，应填进输入框并回到聊天页
  els.rail.querySelector('button[data-view="ask"]').click();
  const before = { view: state.view, input: els.input.value, readPage: state.readPage };
  els.askList.querySelectorAll('button')[0].click();
  out.quickAsk = {
    before,
    after: { view: state.view, input: els.input.value, readPage: state.readPage, aria: els.btnReadPage.getAttribute('aria-pressed') },
  };

  els.input.value = '';
  setReadPage(false);
  out.afterReset = { readPage: state.readPage, view: state.view };
  return out;
})()
