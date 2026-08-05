import { expect, test } from 'bun:test';
import {
  getCatalog,
  getDefaultAdapterIds,
  resolveAdapters,
  sanitizeEnabledAdapterIds,
} from './registry.ts';

const FILE_ADAPTER_IDS = [
  'antigravity',
  'codebuddy',
  'command-code',
  'droid',
  'gemini-cli',
  'github-copilot',
  'junie',
  'kilo',
  'kimi-cli',
  'kiro-cli',
  'mux',
  'qwen-code',
  'windsurf',
] as const;

test('documented file adapters are implemented and default-enabled', () => {
  const catalog = getCatalog();
  const defaults = getDefaultAdapterIds();
  for (const id of FILE_ADAPTER_IDS) {
    expect(catalog.find((entry) => entry.id === id)?.implemented).toBe(true);
    expect(defaults).toContain(id);
  }
});

test('unsupported catalog entries cannot be enabled or resolved', () => {
  expect(sanitizeEnabledAdapterIds(['amp', 'cline', 'iflow-cli', 'aider', 'cursor'])).toEqual([
    'cursor',
  ]);
  expect(resolveAdapters(['amp', 'iflow-cli', 'cursor']).map((adapter) => adapter.agent)).toEqual([
    'cursor',
  ]);
  expect(getDefaultAdapterIds()).not.toContain('amp');
  expect(getDefaultAdapterIds()).not.toContain('cline');
  expect(getDefaultAdapterIds()).not.toContain('iflow-cli');
  expect(getDefaultAdapterIds()).not.toContain('aider');
});

test('stock OpenCode and Oh My OpenCode are distinct supported adapters', () => {
  expect(resolveAdapters(['opencode', 'oh-my-opencode']).map((adapter) => adapter.agent)).toEqual([
    'opencode',
    'oh-my-opencode',
  ]);
  expect(getCatalog().find((entry) => entry.id === 'mcpjam')).toBeUndefined();
});
