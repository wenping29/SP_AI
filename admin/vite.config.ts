import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // 后端地址从 admin/.env 读取，.env.local 可覆盖且不入版本库
  const env = loadEnv(mode, __dirname, '');

  return {
    plugins: [react()],
    // 默认挂在后端 /admin/ 下；独立 nginx 托管在根路径时用 vite.config.standalone.ts
    base: './',
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:7788',
          changeOrigin: true,
        },
      },
    },
  };
});
