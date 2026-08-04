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
  test('rewrites Windows .cmd shims through cmd.exe', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const result = resolveSpawnInvocation([
      'C:\\Users\\Test\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd',
      '-g',
      'C:\\Users\\Test User\\project\\file.ts:42',
    ]);

    expect(result.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(result.args[0]).toBe('/d');
    expect(result.args[1]).toBe('/s');
    expect(result.args[2]).toBe('/c');
    expect(result.args[3]).toBe(
      'C:\\Users\\Test\\AppData\\Local\\Programs\\cursor\\resources\\app\\bin\\cursor.cmd -g "C:\\Users\\Test User\\project\\file.ts:42"',
    );
    expect(result.options.windowsVerbatimArguments).toBe(true);
  });

  test('leaves non-script binaries unchanged on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const argv = ['C:\\Editors\\code.exe', '-g', 'C:\\file.ts:1'];
    const result = resolveSpawnInvocation(argv);
    expect(result.command).toBe(argv[0]);
    expect(result.args).toEqual(argv.slice(1));
    expect(result.options.windowsVerbatimArguments).toBeUndefined();
  });
});
