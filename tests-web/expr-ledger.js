(async () => {
  const stored = await chrome.storage.local.get(['token', 'server', 'deviceId']);
  const response = await fetch(`${stored.server}/api/credits`, {
    headers: { Authorization: `Bearer ${stored.token}` },
  });
  const data = await response.json();
  return {
    deviceId: stored.deviceId,
    server: stored.server,
    balance: data.balance,
    transactions: data.transactions.slice(0, 8),
  };
})();
