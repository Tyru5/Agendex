declare module 'bun:test' {
  export function test(name: string, fn: () => unknown | Promise<unknown>): void;
  export function test(name: string, options: unknown, fn: () => unknown | Promise<unknown>): void;
  export function describe(name: string, fn: () => unknown | Promise<unknown>): void;
  export function beforeEach(fn: () => unknown | Promise<unknown>): void;
  export function afterEach(fn: () => unknown | Promise<unknown>): void;

  interface Matcher {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toHaveLength(expected: number): void;
    toMatchObject(expected: unknown): void;
    toThrow(expected?: unknown): void;
    toBeNumber(): void;
    toBeLessThan(expected: number | bigint): void;
    toBeGreaterThan(expected: number | bigint): void;
    toMatch(expected: unknown): void;
    not: Matcher;
    rejects: AsyncMatcher;
  }

  interface AsyncMatcher {
    toThrow(expected?: unknown): Promise<void>;
  }

  export const expect: (actual: unknown) => Matcher;
}
