(() => {
  setReadPage(false);
  els.input.value = '';
  els.send.click();
  return { clicked: true, model: state.model, attachmentsBefore: state.attachments.length };
})()
