import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import tidewave from 'tidewave/vite-plugin';
import { defineConfig } from 'vite';
import { createAgendexViteConfig } from '../../vite.base';

export default defineConfig(
  createAgendexViteConfig({
    envDir: '.',
    plugins: [tailwindcss(), tidewave(), react()],
    resolve: {
      alias: {
        '@convex': path.resolve(__dirname, 'convex'),
      },
    },
    server: {
      port: 5174,
      host: 'agendex.localhost',
      allowedHosts: process.env.AMP_ORB ? true : ['agendex.localhost', 'app.agendex.localhost'],
      ...(process.env.AMP_ORB
        ? {
            proxy: {
              '/api/auth': {
                target: 'http://127.0.0.1:3211',
                changeOrigin: true,
              },
              '/api/v1': {
                target: 'http://127.0.0.1:4890',
                changeOrigin: true,
              },
              '/api': {
                target: 'http://127.0.0.1:3210',
                changeOrigin: true,
                ws: true,
              },
            },
          }
        : {}),
    },
  }),
);
