import { expect, test } from 'bun:test';
import { parseBenchmarkOptions, runKdfBenchmark } from './obfuscation-kdf-benchmark.ts';

test('defaults to the shipped workspace-wrapper parameters', () => {
  expect(parseBenchmarkOptions([])).toMatchObject({
    algorithm: 'argon2id',
    memorySize: 64 * 1024,
    kdfIterations: 11,
    parallelism: 1,
    dkLen: 32,
    runs: 1,
  });
});

test('parses explicit scrypt benchmark options', () => {
  expect(
    parseBenchmarkOptions([
      '--algorithm',
      'scrypt',
      '--n',
      '4096',
      '--r',
      '4',
      '--p',
      '2',
      '--dk-len',
      '16',
      '--runs',
      '2',
      '--maxmem-mib',
      '32',
      '--json',
    ]),
  ).toMatchObject({
    algorithm: 'scrypt',
    N: 4096,
    r: 4,
    p: 2,
    dkLen: 16,
    runs: 2,
    maxmem: 32 * 1024 * 1024,
    json: true,
  });
});

test('rejects unsafe or ambiguous options', () => {
  expect(() => parseBenchmarkOptions(['--n', '3000'])).toThrow('power of two');
  expect(() => parseBenchmarkOptions(['--n', '4294967297'])).toThrow('power of two');
  expect(() => parseBenchmarkOptions(['--kdf-iterations', '21'])).toThrow('20 or less');
  expect(() => parseBenchmarkOptions(['--runs', '21'])).toThrow('20 or less');
  expect(() => parseBenchmarkOptions(['--maxmem-mib', String(Number.MAX_SAFE_INTEGER)])).toThrow(
    'too large',
  );
  expect(() => parseBenchmarkOptions(['--wat'])).toThrow('Unknown option');
});

test('runs a low-cost Argon2id measurement and reports finite values', async () => {
  const options = parseBenchmarkOptions([
    '--memory-mib',
    '1',
    '--kdf-iterations',
    '2',
    '--runs',
    '2',
  ]);
  const result = await runKdfBenchmark(options);

  expect(result.algorithm).toBe('argon2id');
  expect(result.durationsMs).toHaveLength(2);
  expect(result.durationsMs.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(result.medianMs)).toBe(true);
  expect(Number.isFinite(result.peakRssDeltaMiB)).toBe(true);
  expect(Number.isFinite(result.endingRssDeltaMiB)).toBe(true);
  expect(result.runtime.bun.length).toBeGreaterThan(0);
});
