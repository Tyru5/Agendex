/// <reference types="vite/client" />

// `vite` is a devDependency of the app packages, not of `@agendex/web`, so the
// reference above only resolves when an app compiles this package. The
// declarations below cover the Vite features this package uses when it is
// type-checked on its own; they merge with Vite's own types otherwise.

interface ImportMeta {
  glob<M>(
    pattern: string | string[],
    options?: { eager?: false },
  ): Record<string, () => Promise<M>>;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
