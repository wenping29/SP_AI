export type PermissionAction = 'view' | 'manage';

export interface PermissionModule {
  key: string;
  label: string;
  actions: PermissionAction[];
}

// 与后端 AdminPermissions.Keys 保持一致
export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'dashboard', label: '仪表盘', actions: ['view'] },
  { key: 'devices', label: '设备管理', actions: ['view', 'manage'] },
  { key: 'models', label: '模型管理', actions: ['view', 'manage'] },
  { key: 'policy', label: '运营策略', actions: ['view', 'manage'] },
  { key: 'keyenvs', label: 'KeyEnv 管理', actions: ['view', 'manage'] },
  { key: 'server', label: '服务器配置', actions: ['view', 'manage'] },
  { key: 'users', label: '用户管理', actions: ['view', 'manage'] },
  { key: 'admins', label: '管理员', actions: ['view', 'manage'] },
  { key: 'roles', label: '角色管理', actions: ['view', 'manage'] },
];

export const ACTION_LABELS: Record<PermissionAction, string> = {
  view: '查看',
  manage: '管理',
};

export const ALL_PERMISSIONS = PERMISSION_MODULES.flatMap((module) =>
  module.actions.map((action) => `${module.key}.${action}`),
);

export function permissionLabel(permission: string) {
  if (permission === '*') return '全部权限';
  const [moduleKey, action] = permission.split('.');
  const module = PERMISSION_MODULES.find((item) => item.key === moduleKey);
  if (!module) return permission;
  return `${module.label} · ${ACTION_LABELS[action as PermissionAction] ?? action}`;
}

export function permissionSummary(permissions: string[]) {
  if (permissions.includes('*')) return ['全部权限'];
  return permissions.map(permissionLabel);
}

const ROUTE_ORDER: Array<{ path: string; permission: string }> = [
  { path: '/dashboard', permission: 'dashboard.view' },
  { path: '/devices', permission: 'devices.view' },
  { path: '/credits', permission: 'devices.view' },
  { path: '/models', permission: 'models.view' },
  { path: '/policy', permission: 'policy.view' },
  { path: '/providers', permission: 'keyenvs.view' },
  { path: '/server', permission: 'server.view' },
  { path: '/users', permission: 'users.view' },
  { path: '/admins', permission: 'admins.view' },
  { path: '/roles', permission: 'roles.view' },
];

export function firstAllowedRoute(permissions: string[]) {
  const allowed = ROUTE_ORDER.find((item) =>
    permissions.includes('*') ||
    permissions.includes(item.permission) ||
    permissions.includes(item.permission.replace('.view', '.manage')),
  );
  return allowed?.path ?? '/forbidden';
}
