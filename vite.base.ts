import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

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

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const WORKSPACE_PACKAGE_DIRS = ['app', 'cli', 'ee', 'shared', 'web'].map((name) =>
  path.join(WORKSPACE_ROOT, 'packages', name, 'src'),
);

// Vite's chokidar watcher recursively watches the project root, but for files
// imported from sibling workspace packages it only adds individual file paths
// via `watcher.add(file)`. Editors that use atomic writes (write-to-temp +
// rename, e.g. Claude Code's Edit tool) replace the inode, breaking the
// per-file watch and silently disabling HMR for those files. Watching the
// parent directories restores HMR for cross-package edits.
function watchWorkspacePackages(): Plugin {
  return {
    name: 'agendex:watch-workspace-packages',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(WORKSPACE_PACKAGE_DIRS);
    },
  };
}

export function createAgendexViteConfig(config: AgendexViteConfig) {
  return {
    ...config,
    plugins: [...config.plugins, watchWorkspacePackages()],
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
