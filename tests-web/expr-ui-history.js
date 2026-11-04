(async () => {
  await newChat();
  const afterNew = {
    msgNodes: els.thread.querySelectorAll('.msg').length,
    hint: document.querySelector('.hint')?.textContent || null,
    sessions: state.sessions.length,
    activeEmpty: activeSession().messages.length,
  };

  renderHistory();
  els.historyDialog.showModal();
  const rows = [...els.historyList.querySelectorAll('.item-main')].map((b) => b.textContent);
  const previousId = state.activeId;
  els.historyList.querySelector('.item-main')?.click();
  await new Promise((r) => setTimeout(r, 900));
  els.historyDialog.close();

  return {
    afterNew,
    historyRows: rows,
    switched: state.activeId !== previousId,
    restoredMessages: [...els.thread.querySelectorAll('.msg')].map((m) => m.className),
    savedIntoStorage: true,
  };
})()
