import { afterEach, expect, test } from 'bun:test';
import {
  applyRuntimeEnvVars,
  mergeWorkerEnv,
  parseWslDistroList,
  parseWindowsAgentEnv,
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

test('parseWslDistroList decodes UTF-16LE wsl -l output and strips default marker', () => {
  const text = '* Ubuntu\0\r\nDebian\0\r\n';
  // Build a realistic UTF-16LE buffer for "Ubuntu\r\nDebian\r\n"
  const utf16 = Buffer.from('Ubuntu\r\nDebian\r\n', 'utf16le');
  expect(parseWslDistroList(utf16)).toEqual(['Ubuntu', 'Debian']);

  const marked = Buffer.from('* Ubuntu\r\nDebian\r\n', 'utf16le');
  expect(parseWslDistroList(marked)).toEqual(['Ubuntu', 'Debian']);

  // UTF-8 fallback
  expect(parseWslDistroList(Buffer.from('Ubuntu\nDebian\n', 'utf8'))).toEqual([
    'Ubuntu',
    'Debian',
  ]);
  void text;
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
