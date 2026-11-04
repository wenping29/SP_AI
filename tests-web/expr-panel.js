(() => {
  const nodes = [...document.querySelectorAll('#thread .msg')];
  return {
    status: document.getElementById('status').textContent,
    balanceChip: document.getElementById('balance').textContent,
    messageCount: nodes.length,
    lastTwo: nodes.slice(-2).map((node) => ({
      kind: node.className,
      text: node.textContent.slice(0, 150),
    })),
  };
})();
