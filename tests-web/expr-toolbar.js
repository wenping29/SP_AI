(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const paragraph = document.querySelector('article p');
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  await sleep(500);

  const host = [...document.documentElement.children].reverse().find(
    (node) => node.tagName === 'DIV' && node.shadowRoot,
  );
  if (!host) return { error: '找不到带 shadowRoot 的浮层宿主' };

  const bar = host.shadowRoot.querySelector('.bar');
  if (!bar) return { error: '宿主里没有 .bar', shadowHtmlHead: host.shadowRoot.innerHTML.slice(0, 80) };

  const buttons = [...bar.querySelectorAll('button')].map((button) => {
    const rect = button.getBoundingClientRect();
    return {
      label: button.textContent,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      width: Math.round(rect.width),
    };
  });

  return {
    selectionText: sel.toString().slice(0, 30),
    barDisplay: getComputedStyle(bar).display,
    barPosition: { left: bar.style.left, top: bar.style.top },
    buttons,
  };
})();
