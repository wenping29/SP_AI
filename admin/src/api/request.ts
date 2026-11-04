import axios from 'axios';
import { message } from 'antd';
import { ADMIN_KEY_STORAGE } from '@/store/auth';

const baseURL = (import.meta.env.VITE_API_BASE as string) ?? '/api';

const request = axios.create({ baseURL, timeout: 15000 });

request.interceptors.request.use((cfg) => {
  const key = sessionStorage.getItem(ADMIN_KEY_STORAGE);
  if (key) cfg.headers['X-Admin-Key'] = key;
  return cfg;
});

request.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const status = err.response?.status as number | undefined;
    const text = err.response?.data?.message as string | undefined;

    if (status === 401) {
      sessionStorage.removeItem(ADMIN_KEY_STORAGE);
      message.error(text || '管理密钥不正确');
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = `${import.meta.env.BASE_URL}login`;
      }
    } else if (status === 503) {
      message.error(text || '管理接口未启用，请先配置 Admin__Key');
    } else {
      message.error(text || '网络错误，请稍后再试');
    }

    return Promise.reject(err);
  },
);

export async function get<T>(url: string, params?: object) {
  const r = await request.get<T>(url, { params });
  return r.data;
}

export async function post<T>(url: string, data?: object) {
  const r = await request.post<T>(url, data);
  return r.data;
}

export async function put<T>(url: string, data?: object) {
  const r = await request.put<T>(url, data);
  return r.data;
}

export async function del<T>(url: string) {
  const r = await request.delete<T>(url);
  return r.data;
}
