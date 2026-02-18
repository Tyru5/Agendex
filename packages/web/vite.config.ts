import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

import tidewave from 'tidewave/vite-plugin';

const ngrokAllowedHosts = ['.ngrok-free.app', '.ngrok.io', '.ngrok.app', '.ngrok.dev'];
const extraAllowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  root: 'src/client',
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react(), tidewave()],
  resolve: {
    alias: {
      '@convex': path.resolve(__dirname, 'convex'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    allowedHosts: [...ngrokAllowedHosts, ...extraAllowedHosts],
    proxy: {
      '/api': {
        target: 'http://localhost:4890',
        changeOrigin: true,
      },
    },
  },
});
