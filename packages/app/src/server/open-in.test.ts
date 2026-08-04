import { afterEach, describe, expect, test } from 'bun:test';
import { resolveSpawnInvocation } from './open-in.ts';

const originalPlatform = process.platform;
const originalComSpec = process.env.ComSpec;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  if (originalComSpec === undefined) delete process.env.ComSpec;
  else process.env.ComSpec = originalComSpec;
});

describe('resolveSpawnInvocation', () => {
  // User story: Windows users can launch source paths through editor command shims.
  test('rewrites Windows .cmd shims through cmd.exe with env argv handoff', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const bin =
      'C:\\Users\\Test\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd';
    const target = 'C:\\Users\\Test User\\project\\file.ts:42';
    const result = resolveSpawnInvocation([bin, '-g', target]);

    expect(result.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(result.args).toEqual([
      '/d',
      '/s',
      '/c',
      // Outer quotes survive cmd's strip-first-and-last-quote rule for /c.
      '""%AGENDEX_OPEN_ARGV_0%" "%AGENDEX_OPEN_ARGV_1%" "%AGENDEX_OPEN_ARGV_2%""',
    ]);
    expect(result.options.windowsVerbatimArguments).toBe(true);
    expect(result.options.env?.AGENDEX_OPEN_ARGV_0).toBe(bin);
    expect(result.options.env?.AGENDEX_OPEN_ARGV_1).toBe('-g');
    expect(result.options.env?.AGENDEX_OPEN_ARGV_2).toBe(target);
  });

  // User story: literal percent characters in Windows paths are not expanded by cmd.exe.
  test('hands percent-containing paths via env so cmd.exe cannot expand them', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const literalPath = 'C:\\Users\\%USERNAME%\\project\\file.ts:10';
    const result = resolveSpawnInvocation(['C:\\Editors\\code.cmd', '-g', literalPath]);

    // Cmdline must not embed the literal percent path — only an env reference.
    expect(result.args[3]).not.toContain('%USERNAME%');
    expect(result.args[3]).toContain('%AGENDEX_OPEN_ARGV_2%');
    // Env holds the original bytes; cmd expands the var once (non-recursively),
    // so the shim receives the literal `%USERNAME%` path segment.
    expect(result.options.env?.AGENDEX_OPEN_ARGV_2).toBe(literalPath);
  });

  // User story: native Windows editor executables launch without an unnecessary shell.
  test('leaves non-script binaries unchanged on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const argv = ['C:\\Editors\\code.exe', '-g', 'C:\\file.ts:1'];
    const result = resolveSpawnInvocation(argv);
    expect(result.command).toBe(argv[0]);
    expect(result.args).toEqual(argv.slice(1));
    expect(result.options.windowsVerbatimArguments).toBeUndefined();
    expect(result.options.env).toBeUndefined();
  });
});
