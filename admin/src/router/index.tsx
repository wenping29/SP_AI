import type { ReactElement } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import BasicLayout from '@/layouts/BasicLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import DeviceList from '@/pages/devices/DeviceList';
import CreditsList from '@/pages/credits/CreditsList';
import ModelList from '@/pages/models/ModelList';
import PolicySettings from '@/pages/policy/PolicySettings';
import ProviderList from '@/pages/providers/ProviderList';
import ServerSettings from '@/pages/server/ServerSettings';
import UserList from '@/pages/users/UserList';
import AdminList from '@/pages/admins/AdminList';
import RoleList from '@/pages/roles/RoleList';
import PaymentManagement from '@/pages/payments/PaymentManagement';
import Forbidden from '@/pages/Forbidden';
import { useAuth } from '@/store/auth';

function RequireAuth({ children }: { children: ReactElement }) {
  const token = useAuth((s) => s.token);
  const key = useAuth((s) => s.key);
  return token || key ? children : <Navigate to="/login" replace />;
}

function RequirePermission({ permission, children }: { permission: string; children: ReactElement }) {
  const can = useAuth((s) => s.can);
  return can(permission) ? children : <Navigate to="/forbidden" replace />;
}

// base './' 时 BASE_URL 是 './'，去掉尾斜杠会得到 '.'，路由一条都匹配不上（页面空白且不报错）；
// 相对 base 无法表达子路径，按根路径处理。
const rawBase = import.meta.env.BASE_URL;
const basename = rawBase.startsWith('/') ? rawBase.replace(/\/$/, '') : '';

export const router = createBrowserRouter(
  [
    { path: '/login', element: <Login /> },
    {
      path: '/',
      element: (
        <RequireAuth>
          <BasicLayout />
        </RequireAuth>
      ),
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        {
          path: 'dashboard',
          element: (
            <RequirePermission permission="dashboard.view">
              <Dashboard />
            </RequirePermission>
          ),
        },
        {
          path: 'devices',
          element: (
            <RequirePermission permission="devices.view">
              <DeviceList />
            </RequirePermission>
          ),
        },
        {
          path: 'credits',
          element: (
            <RequirePermission permission="devices.view">
              <CreditsList />
            </RequirePermission>
          ),
        },
        {
          path: 'models',
          element: (
            <RequirePermission permission="models.view">
              <ModelList />
            </RequirePermission>
          ),
        },
        {
          path: 'policy',
          element: (
            <RequirePermission permission="policy.view">
              <PolicySettings />
            </RequirePermission>
          ),
        },
        {
          path: 'payments',
          element: (
            <RequirePermission permission="policy.view">
              <PaymentManagement />
            </RequirePermission>
          ),
        },
        {
          path: 'providers',
          element: (
            <RequirePermission permission="keyenvs.view">
              <ProviderList />
            </RequirePermission>
          ),
        },
        {
          path: 'server',
          element: (
            <RequirePermission permission="server.view">
              <ServerSettings />
            </RequirePermission>
          ),
        },
        {
          path: 'users',
          element: (
            <RequirePermission permission="users.view">
              <UserList />
            </RequirePermission>
          ),
        },
        {
          path: 'admins',
          element: (
            <RequirePermission permission="admins.view">
              <AdminList />
            </RequirePermission>
          ),
        },
        {
          path: 'roles',
          element: (
            <RequirePermission permission="roles.view">
              <RoleList />
            </RequirePermission>
          ),
        },
        { path: 'forbidden', element: <Forbidden /> },
        { path: '*', element: <Navigate to="/dashboard" replace /> },
      ],
    },
  ],
  { basename: basename || undefined },
);
