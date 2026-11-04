import type { ReactElement } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import BasicLayout from '@/layouts/BasicLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import DeviceList from '@/pages/devices/DeviceList';
import ModelList from '@/pages/models/ModelList';
import PolicySettings from '@/pages/policy/PolicySettings';
import ProviderList from '@/pages/providers/ProviderList';
import { ADMIN_KEY_STORAGE } from '@/store/auth';

function RequireAuth({ children }: { children: ReactElement }) {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE) ? children : <Navigate to="/login" replace />;
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
        { path: 'dashboard', element: <Dashboard /> },
        { path: 'devices', element: <DeviceList /> },
        { path: 'models', element: <ModelList /> },
        { path: 'policy', element: <PolicySettings /> },
        { path: 'providers', element: <ProviderList /> },
        { path: '*', element: <Navigate to="/dashboard" replace /> },
      ],
    },
  ],
  { basename: basename || undefined },
);
