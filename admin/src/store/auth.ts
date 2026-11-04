import { create } from 'zustand';

export const ADMIN_KEY_STORAGE = 'sp_admin_key';
export const ADMIN_TOKEN_STORAGE = 'sp_admin_token';

export interface AdminIdentity {
  id: number | null;
  username: string;
  displayName: string;
  roleName: string;
  permissions: string[];
  source: 'key' | 'user';
}

export function permissionGranted(permissions: string[], permission: string) {
  return (
    permissions.includes('*') ||
    permissions.includes(permission) ||
    (permission.endsWith('.view') && permissions.includes(`${permission.slice(0, -5)}.manage`))
  );
}

interface AuthState {
  token: string | null;
  key: string | null;
  identity: AdminIdentity | null;
  setToken: (token: string) => void;
  setKey: (key: string) => void;
  setIdentity: (identity: AdminIdentity | null) => void;
  logout: () => void;
  can: (permission: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: sessionStorage.getItem(ADMIN_TOKEN_STORAGE),
  key: sessionStorage.getItem(ADMIN_KEY_STORAGE),
  identity: null,
  setToken: (token) => {
    sessionStorage.setItem(ADMIN_TOKEN_STORAGE, token);
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    set({ token, key: null });
  },
  setKey: (key) => {
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE);
    set({ key, token: null });
  },
  setIdentity: (identity) => set({ identity }),
  logout: () => {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE);
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    set({ token: null, key: null, identity: null });
  },
  can: (permission) => {
    const identity = get().identity;
    return identity ? permissionGranted(identity.permissions, permission) : false;
  },
}));
