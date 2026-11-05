/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端接口 baseURL，见 admin/.env */
  readonly VITE_API_BASE?: string;
  /** dev 服务器 /api 代理目标，仅 vite.config.ts 使用，不进产物 */
  readonly VITE_DEV_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
