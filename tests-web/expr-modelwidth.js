(() => {
  const el = document.querySelector('#model');
  if (!el) return { ok: false, reason: 'no #model' };
  const cs = getComputedStyle(el);
  return {
    ok: true,
    maxWidth: cs.maxWidth,
    offsetWidth: el.offsetWidth,
    fontSize: cs.fontSize,
    padding: cs.padding,
    selectedText: el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : null,
    rowCount: el.options.length,
  };
})();
