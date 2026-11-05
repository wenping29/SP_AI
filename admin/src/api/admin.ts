import type { AdminIdentity } from '@/store/auth';
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
  isBlocked: boolean;
  createdAt: string;
  lastUsedAt: string;
  // 设备当前登录的用户账号；积分记在该账号上
  loggedIn: boolean;
  accountEmail: string;
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

export interface CreditSummary {
  users: number;
  totalBalance: number;
  blocked: number;
  spent: number;
  calls: number;
}

export interface CreditAdjust {
  deviceId: string;
  delta?: number;
  balance?: number;
  reason?: string;
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
  isDeprecated: boolean;
  category: string;
  sortOrder: number;
  note: string;
}

export type ModelUpdate = Partial<
  Pick<
    ModelSpec,
    | 'displayName'
    | 'provider'
    | 'upstreamModel'
    | 'inputRatePer1K'
    | 'outputRatePer1K'
    | 'maxContextChars'
    | 'supportsVision'
    | 'isEnabled'
    | 'category'
    | 'sortOrder'
    | 'note'
  >
>;

export interface ModelCreate extends ModelUpdate {
  modelId: string;
  displayName: string;
  provider: string;
  upstreamModel: string;
}

export interface ModelProvider {
  provider: string;
  baseUrl: string;
}

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

export interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  implicitTls: boolean;
  user: string;
  passwordSet: boolean;
  passwordSource: KeySource;
  from: string;
  fromName: string;
  codeMinutes: number;
  exposeDevCode: boolean;
  configured: boolean;
  source: 'env' | 'database';
  warning?: string | null;
}

export interface ServerRuntime {
  environment: string;
  version: string;
  framework: string;
  urls: string;
  databaseFile: string;
  keysPath: string;
  startedAt: string;
  uptimeSeconds: number;
}

export interface ServerConfigView {
  email: EmailSettings;
  allowedOrigins: string[];
  allowedOriginsSource: 'config' | 'database' | 'none';
  runtime: ServerRuntime;
}

export interface ServerConfigUpdate {
  smtpEnabled?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpImplicitTls?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  clearSmtpPassword?: boolean;
  smtpFrom?: string;
  smtpFromName?: string;
  codeMinutes?: number;
  exposeDevCode?: boolean;
  allowedOrigins?: string[];
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

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  roleId: number;
  roleName: string;
  isDisabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserCreate {
  username: string;
  displayName?: string;
  roleId: number;
  password: string;
}

export interface AdminUserUpdate {
  displayName?: string;
  roleId?: number;
  password?: string;
  isDisabled?: boolean;
}

export interface AdminRole {
  id: number;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

export interface Member {
  id: number;
  email: string;
  displayName: string;
  isBlocked: boolean;
  balance: number;
  spent: number;
  calls: number;
  // 用户计费账号的 deviceId，调分与流水都按它落库
  accountDeviceId: string;
  deviceCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface MemberPage {
  total: number;
  page: number;
  pageSize: number;
  items: Member[];
}

export interface MemberCreate {
  email: string;
  displayName?: string;
  password: string;
}

export interface MemberUpdate {
  email?: string;
  displayName?: string;
  password?: string;
}

export const adminApi = {
  login: (username: string, password: string) =>
    post<{ token: string; expiresAt: string; user: AdminIdentity }>('/admin/auth/login', {
      username,
      password,
    }),

  me: () => get<AdminIdentity>('/admin/auth/me'),

  logout: () => post<{ ok: boolean }>('/admin/auth/logout'),

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

  creditSummary: () => get<CreditSummary>('/admin/credits/summary'),

  adjustCredits: (data: CreditAdjust) =>
    post<{ deviceId: string; label: string; delta: number; balance: number }>(
      '/admin/credits/adjust',
      data,
    ),

  models: () => get<ModelSpec[]>('/admin/models'),

  modelProviders: () => get<ModelProvider[]>('/admin/model-providers'),

  createModel: (data: ModelCreate) => post<ModelSpec>('/admin/models', data),

  updateModel: (modelId: string, data: ModelUpdate) =>
    put<ModelSpec>(`/admin/models/${encodeURIComponent(modelId)}`, data),

  deleteModel: (modelId: string) =>
    del<{ modelId: string; deleted: boolean }>(`/admin/models/${encodeURIComponent(modelId)}`),

  deprecateModel: (modelId: string, deprecated: boolean) =>
    post<ModelSpec>(`/admin/models/${encodeURIComponent(modelId)}/deprecate`, { deprecated }),

  policy: () => get<CreditPolicy>('/admin/policy'),

  updatePolicy: (data: PolicyUpdate) => put<CreditPolicy>('/admin/policy', data),

  serverConfig: () => get<ServerConfigView>('/admin/server'),

  updateServerConfig: (data: ServerConfigUpdate) =>
    put<ServerConfigView>('/admin/server', data),

  testServerEmail: (to: string) =>
    post<{ ok: boolean; to: string }>('/admin/server/test-email', { to }),

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

  users: () => get<AdminUser[]>('/admin/users'),

  createUser: (data: AdminUserCreate) => post<AdminUser>('/admin/users', data),

  updateUser: (id: number, data: AdminUserUpdate) => put<AdminUser>(`/admin/users/${id}`, data),

  deleteUser: (id: number) => del<{ id: number; deleted: boolean }>(`/admin/users/${id}`),

  roles: () => get<AdminRole[]>('/admin/roles'),

  createRole: (data: AdminRoleInput) => post<AdminRole>('/admin/roles', data),

  updateRole: (id: number, data: AdminRoleInput) => put<AdminRole>(`/admin/roles/${id}`, data),

  deleteRole: (id: number) => del<{ id: number; deleted: boolean }>(`/admin/roles/${id}`),

  members: (params: { q?: string; page: number; pageSize: number }) =>
    get<MemberPage>('/admin/members', params),

  createMember: (data: MemberCreate) => post<Member>('/admin/members', data),

  updateMember: (id: number, data: MemberUpdate) => put<Member>(`/admin/members/${id}`, data),

  blockMember: (id: number, blocked: boolean) =>
    post<Member>(`/admin/members/${id}/block`, { blocked }),

  deleteMember: (id: number) => del<{ id: number; deleted: boolean }>(`/admin/members/${id}`),
};
