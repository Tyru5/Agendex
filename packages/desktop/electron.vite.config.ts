import { defineConfig } from 'electron-vite';

// The renderer is served by the app Vite server in dev and by the in-process
// Node server in prod, so electron-vite only builds `main` and `preload` here.
//
// We intentionally do NOT use `externalizeDepsPlugin`: the backend lives in the
// `@agendex/app`/`@agendex/shared` TypeScript workspace packages, which must be
// bundled into `out/main` (they ship no built JS). There are no native modules
// on the runtime path, so bundling everything except `electron` is safe.
export default defineConfig({
  main: {
    // electron-vite auto-applies `externalizeDepsPlugin` (build.externalizeDeps
    // defaults to true), which keeps node_modules out of the bundle. Disable it
    // so the workspace TS packages, hono, and the node adapters get bundled into
    // out/main; only `electron` and node built-ins stay external.
    build: {
      externalizeDeps: false,
      rollupOptions: {
        // `electron` + node built-ins stay external. `bufferutil` and
        // `utf-8-validate` are optional native deps of `ws` (pulled in by
        // @hono/node-ws); they are not installed, and `ws` already wraps their
        // `require()` in try/catch to fall back to its pure-JS implementation.
        // Keep them external so the bundler emits a real `require()` (which ws
        // catches) instead of turning the unresolved import into a hard throw.
        external: ['electron', 'bufferutil', 'utf-8-validate'],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
});
