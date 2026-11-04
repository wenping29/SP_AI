import { create } from 'zustand';

export const ADMIN_KEY_STORAGE = 'sp_admin_key';

interface AuthState {
  key: string | null;
  setKey: (key: string) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  key: sessionStorage.getItem(ADMIN_KEY_STORAGE),
  setKey: (key) => {
    sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    set({ key });
  },
  logout: () => {
    sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    set({ key: null });
  },
}));
