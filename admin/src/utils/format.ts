const reasonLabels: Record<string, string> = {
  device_trial: '新设备体验',
  chat: '对话',
  refund: '失败退回',
  voice: '语音输入',
  free_grant: '注册赠送',
  admin_grant: '后台调整',
  admin_set: '后台设为',
  device_merge: '本机积分合并',
  recharge: '充值到账',
};

export function formatTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export function reasonLabel(reason: string) {
  return reasonLabels[reason] ?? reason;
}

export function signed(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

export function deltaClass(value: number) {
  return value >= 0 ? 'delta-positive' : 'delta-negative';
}

export function shortDevice(deviceId: string) {
  return deviceId.length > 18 ? `${deviceId.slice(0, 8)}…${deviceId.slice(-6)}` : deviceId;
}
