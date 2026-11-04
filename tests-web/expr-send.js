(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const value = (id) => document.getElementById(id);

  value('usePage').checked = false;
  value('input').value = '这个浏览器插件怎么计费？只用一句话回答。';
  value('send').click();

  const deadline = Date.now() + 40000;
  let sawStreaming = false;
  while (Date.now() < deadline) {
    if (document.querySelector('.msg.streaming')) sawStreaming = true;
    else if (sawStreaming) break;
    await sleep(200);
  }

  const messages = [...document.querySelectorAll('#thread .msg')].map((node) => ({
    kind: node.className,
    text: node.textContent,
  }));
  return {
    finishedWithoutStreamingObserved: !sawStreaming,
    status: value('status').textContent,
    balanceChip: value('balance').textContent,
    messages,
  };
})();
