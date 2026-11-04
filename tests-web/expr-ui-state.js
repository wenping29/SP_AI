(() => ({
  status: els.status.textContent,
  balance: els.balance.textContent,
  model: state.model,
  readPage: state.readPage,
  busy: state.busy,
  attachments: state.attachments.length,
  messages: [...els.thread.querySelectorAll('.msg')].map((m) => ({
    kind: m.className,
    text: m.textContent.slice(0, 120),
  })),
  sessions: state.sessions.map((s) => ({ title: s.title, count: s.messages.length })),
  activeId: state.activeId,
  lastRequest: state.lastRequest ? { label: state.lastRequest.label, images: state.lastRequest.images.length } : null,
}))()
