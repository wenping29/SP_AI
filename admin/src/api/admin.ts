import { del, get, post, put } from './request';

export interface AdminTransaction {
  id: number;
  deviceId?: string;
  label?: string;
  delta: number;
  reason: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export interface AdminStats {
  accounts: number;
  totalBalance: number;
  blocked: number;
  modelCount: number;
  enabledModels: number;
  calls24h: number;
  consumed24h: number;
  active24h: number;
  recent: AdminTransaction[];
}

export interface Device {
  deviceId: string;
  label: string;
  balance: number;
  isBlocked: boolean;
  createdAt: string;
  lastUsedAt: string;
  spent: number;
  calls: number;
}

export interface DevicePage {
  total: number;
  page: number;
  pageSize: number;
  items: Device[];
}

export interface DeviceTransactions {
  deviceId: string;
  label: string;
  balance: number;
  isBlocked: boolean;
  items: AdminTransaction[];
}

export interface ModelSpec {
  id: number;
  modelId: string;
  displayName: string;
  provider: string;
  upstreamModel: string;
  inputRatePer1K: number;
  outputRatePer1K: number;
  maxContextChars: number;
  supportsVision: boolean;
  isEnabled: boolean;
  sortOrder: number;
  note: string;
}

export type ModelUpdate = Partial<
  Pick<
    ModelSpec,
    | 'displayName'
    | 'inputRatePer1K'
    | 'outputRatePer1K'
    | 'maxContextChars'
    | 'supportsVision'
    | 'isEnabled'
    | 'sortOrder'
    | 'note'
  >
>;

export interface CreditPolicy {
  freeCredits: number;
  chatEnabled: boolean;
  notice: string;
  updatedAt: string;
}

export interface PolicyUpdate {
  freeCredits?: number;
  chatEnabled?: boolean;
  notice?: string;
}

export type KeySource = 'env' | 'database' | 'none';

export interface ProviderKeyStatus {
  provider: string;
  source: KeySource;
  maskedTail: string;
  updatedAt: string | null;
  envOverride: boolean;
}

export interface ProviderSummary {
  provider: string;
  baseUrl: string;
  defaultEnvName: string;
  activeEnvName: string;
  source: KeySource;
  maskedTail: string;
  usable: boolean;
  entryCount: number;
  activeCount: number;
  deprecatedCount: number;
}

export interface KeyEnvEntry {
  id: number;
  provider: string;
  envName: string;
  maskedTail: string;
  isActive: boolean;
  isDeprecated: boolean;
  note: string;
  source: KeySource;
  createdAt: string;
  updatedAt: string;
}

export interface KeyEnvCreate {
  provider: string;
  envName?: string;
  key?: string;
  note?: string;
  activate?: boolean;
}

export interface KeyEnvUpdate {
  envName?: string;
  key?: string;
  clearKey?: boolean;
  note?: string;
}

export const adminApi = {
  stats: () => get<AdminStats>('/admin/stats'),

  devices: (params: { q?: string; page: number; pageSize: number }) =>
    get<DevicePage>('/admin/devices', params),

  deviceTransactions: (deviceId: string, take = 50) =>
    get<DeviceTransactions>(`/admin/devices/${encodeURIComponent(deviceId)}/transactions`, { take }),

  setBlocked: (deviceId: string, blocked: boolean) =>
    post<{ deviceId: string; isBlocked: boolean }>(
      `/admin/devices/${encodeURIComponent(deviceId)}/block`,
      { blocked },
    ),

  grant: (data: { deviceId: string; delta: number; reason?: string }) =>
    post<{ deviceId: string; delta: number; balance: number }>('/admin/grant', data),

  models: () => get<ModelSpec[]>('/admin/models'),

  updateModel: (modelId: string, data: ModelUpdate) =>
    put<ModelSpec>(`/admin/models/${encodeURIComponent(modelId)}`, data),

  policy: () => get<CreditPolicy>('/admin/policy'),

  updatePolicy: (data: PolicyUpdate) => put<CreditPolicy>('/admin/policy', data),

  providers: () => get<ProviderSummary[]>('/admin/providers'),

  saveProviderKey: (provider: string, key: string) =>
    put<ProviderKeyStatus>(`/admin/providers/${encodeURIComponent(provider)}/key`, { key }),

  keyEnvs: (params: { provider?: string; includeDeprecated?: boolean }) =>
    get<KeyEnvEntry[]>('/admin/keyenvs', params),

  createKeyEnv: (data: KeyEnvCreate) => post<KeyEnvEntry>('/admin/keyenvs', data),

  updateKeyEnv: (id: number, data: KeyEnvUpdate) =>
    put<KeyEnvEntry>(`/admin/keyenvs/${id}`, data),

  deleteKeyEnv: (id: number) => del<{ id: number; deleted: boolean }>(`/admin/keyenvs/${id}`),

  activateKeyEnv: (id: number) => post<KeyEnvEntry>(`/admin/keyenvs/${id}/activate`),

  deprecateKeyEnv: (id: number, deprecated: boolean) =>
    post<KeyEnvEntry>(`/admin/keyenvs/${id}/deprecate`, { deprecated }),
};
