import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // 开发期把 /api 转发到后端，省掉 CORS 与跨端口的密钥处理
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
    },
  },
});
