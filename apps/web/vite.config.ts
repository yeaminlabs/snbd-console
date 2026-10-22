import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:3101';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/sso': api,
      '/mcp': api,
      '/oauth': api,
      '/.well-known': api,
      '/ws': { target: api, ws: true },
    },
  },
});
