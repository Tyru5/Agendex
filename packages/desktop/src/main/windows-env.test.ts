import { afterEach, expect, test } from 'bun:test';
import {
  applyRuntimeEnvVars,
  detectWsl,
  mergeWorkerEnv,
  parseWslDistroList,
  parseWslQuietNames,
  parseWindowsAgentEnv,
  resolveDefaultWslDistro,
  resolveRuntimeEnvVars,
  toWindowsWslHomePath,
  type WindowsEnvRuntime,
  type WslDetection,
} from './windows-env.ts';

const originalEnv = {
  AGENDEX_HOME: process.env.AGENDEX_HOME,
  AGENDEX_CONFIG_DIR: process.env.AGENDEX_CONFIG_DIR,
};

afterEach(() => {
  if (originalEnv.AGENDEX_HOME === undefined) delete process.env.AGENDEX_HOME;
  else process.env.AGENDEX_HOME = originalEnv.AGENDEX_HOME;
  if (originalEnv.AGENDEX_CONFIG_DIR === undefined) delete process.env.AGENDEX_CONFIG_DIR;
  else process.env.AGENDEX_CONFIG_DIR = originalEnv.AGENDEX_CONFIG_DIR;
});

test('parseWindowsAgentEnv accepts only native and wsl', () => {
  expect(parseWindowsAgentEnv('native')).toBe('native');
  expect(parseWindowsAgentEnv('wsl')).toBe('wsl');
  expect(parseWindowsAgentEnv('linux')).toBeNull();
  expect(parseWindowsAgentEnv(null)).toBeNull();
});

test('parseWslQuietNames keeps spaced and numeric distro names', () => {
  const quiet = Buffer.from('My Distro 2\r\nUbuntu\r\n', 'utf16le');
  expect(parseWslQuietNames(quiet)).toEqual(['My Distro 2', 'Ubuntu']);
});

test('parseWslDistroList decodes UTF-16LE wsl -l output and strips default marker', () => {
  const utf16 = Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le');
  expect(parseWslDistroList(utf16)).toEqual(['Ubuntu', 'Debian']);

  const marked = Buffer.from('* Ubuntu\r\nDebian\r\n', 'utf16le');
  expect(parseWslDistroList(marked)).toEqual(['Ubuntu', 'Debian']);

  expect(parseWslDistroList(Buffer.from('Ubuntu\nDebian\n', 'utf8'))).toEqual(['Ubuntu', 'Debian']);
});

test('resolveDefaultWslDistro matches marked names including spaces and digits', () => {
  const listed = Buffer.from(
    'Windows Subsystem for Linux Distributions:\r\nUbuntu\r\nMy Distro 2 (Default)\r\n',
    'utf8',
  );
  expect(resolveDefaultWslDistro(listed, ['Ubuntu', 'My Distro 2'])).toBe('My Distro 2');

  const starred = Buffer.from('* My Distro 2\r\nUbuntu\r\n', 'utf16le');
  expect(resolveDefaultWslDistro(starred, ['My Distro 2', 'Ubuntu'])).toBe('My Distro 2');

  // Prefer longer quiet name so "Ubuntu" does not steal "Ubuntu 22".
  const nested = Buffer.from('* Ubuntu 22\r\nUbuntu\r\n', 'utf8');
  expect(resolveDefaultWslDistro(nested, ['Ubuntu', 'Ubuntu 22'])).toBe('Ubuntu 22');
});

test('detectWsl uses quiet names and pins -d to the default distro', async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const runCommand = async (command: string, args: readonly string[]) => {
    calls.push({ command, args });
    if (args[0] === '-l' && args[1] === '-q') {
      return {
        code: 0,
        stdout: Buffer.from('Debian\r\nMy Distro 2\r\n', 'utf16le'),
        stderr: Buffer.alloc(0),
      };
    }
    if (args[0] === '-l') {
      return {
        code: 0,
        stdout: Buffer.from(
          'Windows Subsystem for Linux Distributions:\r\nDebian\r\n* My Distro 2\r\n',
          'utf16le',
        ),
        stderr: Buffer.alloc(0),
      };
    }
    if (args.some((arg) => arg.includes('printf'))) {
      return { code: 0, stdout: Buffer.from('/home/ty', 'utf8'), stderr: Buffer.alloc(0) };
    }
    return { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };

  const detection = await detectWsl(runCommand, { platform: 'win32' });
  expect(detection).toEqual({
    available: true,
    distroName: 'My Distro 2',
    homePath: '\\\\wsl$\\My Distro 2\\home\\ty',
  });
  expect(calls[0]?.args).toEqual(['-l', '-q']);
  expect(calls[1]?.args).toEqual(['-l']);
  expect(calls[2]?.args.slice(0, 2)).toEqual(['-d', 'My Distro 2']);
  expect(calls[3]?.args.slice(0, 2)).toEqual(['-d', 'My Distro 2']);
});

test('toWindowsWslHomePath maps linux home into \\\\wsl$ path', () => {
  expect(toWindowsWslHomePath('Ubuntu', '/home/ty')).toBe('\\\\wsl$\\Ubuntu\\home\\ty');
  expect(toWindowsWslHomePath('Debian', '/home/ty/')).toBe('\\\\wsl$\\Debian\\home\\ty');
});

test('resolveRuntimeEnvVars pins config dir and sets AGENDEX_HOME only for wsl', () => {
  const runtime: WindowsEnvRuntime = {
    nativeHome: 'C:\\Users\\ty',
    nativeConfigDir: 'C:\\Users\\ty\\.agendex',
    isDev: false,
  };
  const available: WslDetection = {
    available: true,
    distroName: 'Ubuntu',
    homePath: '\\\\wsl$\\Ubuntu\\home\\ty',
  };

  const native = resolveRuntimeEnvVars('native', runtime, available);
  expect(native.env).toBe('native');
  expect(native.patch.AGENDEX_CONFIG_DIR).toBe('C:\\Users\\ty\\.agendex');
  expect(native.patch.AGENDEX_HOME).toBeUndefined();

  const wsl = resolveRuntimeEnvVars('wsl', runtime, available);
  expect(wsl.env).toBe('wsl');
  expect(wsl.patch.AGENDEX_HOME).toBe('\\\\wsl$\\Ubuntu\\home\\ty');
  expect(wsl.patch.AGENDEX_CONFIG_DIR).toBe('C:\\Users\\ty\\.agendex');
});

test('resolveRuntimeEnvVars falls back to native when WSL is unavailable', () => {
  const runtime: WindowsEnvRuntime = {
    nativeHome: 'C:\\Users\\ty',
    nativeConfigDir: 'C:\\Users\\ty\\.agendex',
    isDev: false,
  };
  const missing: WslDetection = {
    available: false,
    distroName: null,
    homePath: null,
    error: 'WSL not detected',
  };

  const resolved = resolveRuntimeEnvVars('wsl', runtime, missing);
  expect(resolved.env).toBe('native');
  expect(resolved.error).toBe('WSL not detected');
  expect(resolved.patch.AGENDEX_HOME).toBeUndefined();
});

test('applyRuntimeEnvVars and mergeWorkerEnv set and clear overrides', () => {
  applyRuntimeEnvVars({
    AGENDEX_CONFIG_DIR: 'C:\\Users\\ty\\.agendex',
    AGENDEX_HOME: '\\\\wsl$\\Ubuntu\\home\\ty',
  });
  expect(process.env.AGENDEX_CONFIG_DIR).toBe('C:\\Users\\ty\\.agendex');
  expect(process.env.AGENDEX_HOME).toBe('\\\\wsl$\\Ubuntu\\home\\ty');

  applyRuntimeEnvVars({
    AGENDEX_CONFIG_DIR: 'C:\\Users\\ty\\.agendex',
    AGENDEX_HOME: undefined,
  });
  expect(process.env.AGENDEX_HOME).toBeUndefined();

  const merged = mergeWorkerEnv(
    { PATH: 'x', AGENDEX_HOME: 'old' },
    { AGENDEX_HOME: undefined, AGENDEX_CONFIG_DIR: 'C:\\cfg' },
  );
  expect(merged.PATH).toBe('x');
  expect(merged.AGENDEX_HOME).toBeUndefined();
  expect(merged.AGENDEX_CONFIG_DIR).toBe('C:\\cfg');
});
