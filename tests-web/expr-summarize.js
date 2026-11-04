(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chip = document.querySelector('#actions button[data-id="summarize"]');
  if (!chip) return { error: '没有总结全文按钮' };

  const before = document.querySelectorAll('#thread .msg').length;
  chip.click();

  const deadline = Date.now() + 45000;
  let sawStreaming = false;
  while (Date.now() < deadline) {
    if (document.querySelector('.msg.streaming')) sawStreaming = true;
    else if (sawStreaming) break;
    await sleep(200);
  }

  const nodes = [...document.querySelectorAll('#thread .msg')];
  return {
    messagesAdded: nodes.length - before,
    sawStreaming,
    status: document.getElementById('status').textContent,
    balanceChip: document.getElementById('balance').textContent,
    userBubble: nodes[nodes.length - 2]?.textContent?.slice(0, 160),
    answerBubble: nodes[nodes.length - 1]?.textContent?.slice(0, 400),
    answerKind: nodes[nodes.length - 1]?.className,
  };
})();
