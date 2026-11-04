(() => {
  const messages = [...els.thread.querySelectorAll('.msg')];
  const last = messages.at(-1);
  const buttons = [...last.querySelectorAll('.msg-actions button')].map((b) => b.textContent);

  const find = (label) => [...last.querySelectorAll('.msg-actions button')].find((b) => b.textContent === label);
  find('复制')?.click();
  const afterCopy = els.status.textContent;

  find('引用')?.click();
  const quoted = els.input.value.slice(0, 60);
  els.input.value = '';

  return {
    kinds: messages.map((m) => m.className),
    lastMessageActions: buttons,
    afterCopy,
    quoted,
    regeneratePresent: buttons.includes('重新生成'),
    sessions: state.sessions.map((s) => ({ title: s.title, count: s.messages.length })),
    lastRequest: state.lastRequest ? { label: state.lastRequest.label, images: state.lastRequest.images.length } : null,
  };
})()
