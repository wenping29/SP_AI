(() => ({
  status: els.status.textContent,
  view: state.view,
  attachments: state.attachments.map((a) => ({
    kind: a.kind,
    name: a.name,
    size: (a.dataUrl || a.text || '').length,
  })),
  chips: [...els.attachments.querySelectorAll('.attach .name')].map((n) => n.textContent),
  chipsVisible: !els.attachments.hidden,
  thumbnails: els.attachments.querySelectorAll('img').length,
}))()
