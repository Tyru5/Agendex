import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ngrokAllowedHosts = ['.ngrok-free.app', '.ngrok.io', '.ngrok.app', '.ngrok.dev'];
const extraAllowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
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
