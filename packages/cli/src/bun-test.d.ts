declare module 'bun:test' {
  export function test(name: string, fn: () => unknown | Promise<unknown>): void;
  export function test(name: string, options: unknown, fn: () => unknown | Promise<unknown>): void;
  export function afterEach(fn: () => unknown | Promise<unknown>): void;
  export function beforeEach(fn: () => unknown | Promise<unknown>): void;
  export function spyOn(
    object: object,
    method: string,
  ): {
    mockImplementation(fn: (...args: unknown[]) => unknown): { mockRestore(): void };
    mockRestore(): void;
  };

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
    toMatch(expected: unknown): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledWith(...args: unknown[]): void;
    not: Matcher;
  }

  interface ExpectFn {
    (actual: unknown): Matcher;
    stringContaining(value: string): unknown;
  }

  export const expect: ExpectFn;
}
