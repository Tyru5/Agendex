import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  envDir: '.',
  plugins: [react()],
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
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:4890',
        changeOrigin: true,
      },
    },
  },
});
