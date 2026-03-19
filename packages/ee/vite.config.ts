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
      host: 'agendex.local',
      allowedHosts: ['agendex.local', 'app.agendex.local'],
    },
  }),
);
