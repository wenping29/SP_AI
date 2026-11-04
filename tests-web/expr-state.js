(() => ({
  status: document.getElementById('status').textContent,
  balanceChip: document.getElementById('balance').textContent,
  modelOptionCount: document.getElementById('model').options.length,
  modelSelected: document.getElementById('model').selectedOptions[0]?.textContent || '',
  actionChips: [...document.querySelectorAll('#actions button')].map((b) => b.textContent),
  noticeHidden: document.getElementById('notice').hidden,
  sendDisabled: document.getElementById('send').disabled,
  threadHasHint: Boolean(document.querySelector('.hint')),
  storedKeys: Object.keys(chrome.storage.local),
}))();
