// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgendexViteConfig = {
  envDir?: string;
  plugins: any[];
  resolve?: {
    alias?: Record<string, string>;
  };
  root?: string;
  server?: {
    host?: string;
    allowedHosts?: string[];
    port?: number;
  };
};

export function createAgendexViteConfig(config: AgendexViteConfig) {
  return {
    ...config,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:4890',
          changeOrigin: true,
        },
      },
      ...config.server,
    },
  };
}
