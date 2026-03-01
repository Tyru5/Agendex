import path from 'node:path';
import react from '@vitejs/plugin-react';
import tidewave from 'tidewave/vite-plugin';
import { defineConfig } from 'vite';
import { createAgendexViteConfig } from '../../vite.base';

const ngrokAllowedHosts = ['.ngrok-free.app', '.ngrok.io', '.ngrok.app', '.ngrok.dev'];
const extraAllowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig(
  createAgendexViteConfig({
    root: 'src/client',
    envDir: path.resolve(__dirname, '../..'),
    plugins: [tidewave(), react()],
    server: {
      port: 5173,
      allowedHosts: [...ngrokAllowedHosts, ...extraAllowedHosts],
    },
  }),
);
