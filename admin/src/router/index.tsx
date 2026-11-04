import type { ReactElement } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import BasicLayout from '@/layouts/BasicLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import DeviceList from '@/pages/devices/DeviceList';
import ModelList from '@/pages/models/ModelList';
import PolicySettings from '@/pages/policy/PolicySettings';
import ProviderList from '@/pages/providers/ProviderList';
import UserList from '@/pages/users/UserList';
import RoleList from '@/pages/roles/RoleList';
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

const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

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
          path: 'providers',
          element: (
            <RequirePermission permission="keyenvs.view">
              <ProviderList />
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
