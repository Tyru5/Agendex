import { argon2id, scrypt } from 'hash-wasm';
import { arch, cpus, platform, release, totalmem } from 'node:os';

export interface BenchmarkOptions {
  algorithm: 'argon2id' | 'scrypt';
  memorySize: number;
  kdfIterations: number;
  parallelism: number;
  N: number;
  r: number;
  p: number;
  dkLen: number;
  runs: number;
  maxmem: number;
  json: boolean;
}

export interface BenchmarkResult {
  algorithm: BenchmarkOptions['algorithm'];
  runtime: {
    bun: string;
    platform: string;
    release: string;
    arch: string;
    cpu: string;
    logicalCpus: number;
    totalMemoryMiB: number;
  };
  parameters: Record<string, number>;
  durationsMs: number[];
  minMs: number;
  medianMs: number;
  maxMs: number;
  peakRssDeltaMiB: number;
  endingRssDeltaMiB: number;
}

const DEFAULT_OPTIONS: BenchmarkOptions = {
  algorithm: 'argon2id',
  memorySize: 64 * 1024,
  kdfIterations: 11,
  parallelism: 1,
  N: 2 ** 17,
  r: 8,
  p: 1,
  dkLen: 32,
  runs: 1,
  maxmem: 384 * 1024 * 1024,
  json: false,
};

const BENCHMARK_PASSWORD = new TextEncoder().encode(
  'agendex-obfuscation-kdf-benchmark-password-not-a-user-secret',
);
const BENCHMARK_SALT = new TextEncoder().encode('agendex-kdf-v1-benchmark-salt');

function readPositiveInteger(flag: string, value: string | undefined): number {
  if (value === undefined) throw new Error(`${flag} requires a value`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseBenchmarkOptions(args: string[]): BenchmarkOptions {
  const options = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--json') {
      options.json = true;
      continue;
    }

    const value = args[++index];
    switch (flag) {
      case '--algorithm':
        if (value !== 'argon2id' && value !== 'scrypt') {
          throw new Error('--algorithm must be argon2id or scrypt');
        }
        options.algorithm = value;
        break;
      case '--memory-mib':
        options.memorySize = readPositiveInteger(flag, value) * 1024;
        break;
      case '--kdf-iterations':
        options.kdfIterations = readPositiveInteger(flag, value);
        break;
      case '--parallelism':
        options.parallelism = readPositiveInteger(flag, value);
        break;
      case '--n':
        options.N = readPositiveInteger(flag, value);
        break;
      case '--r':
        options.r = readPositiveInteger(flag, value);
        break;
      case '--p':
        options.p = readPositiveInteger(flag, value);
        break;
      case '--dk-len':
        options.dkLen = readPositiveInteger(flag, value);
        break;
      case '--runs':
        options.runs = readPositiveInteger(flag, value);
        break;
      case '--maxmem-mib': {
        const maxmem = readPositiveInteger(flag, value) * 1024 * 1024;
        if (!Number.isSafeInteger(maxmem)) throw new Error(`${flag} is too large`);
        options.maxmem = maxmem;
        break;
      }
      default:
        throw new Error(`Unknown option: ${flag ?? '<missing>'}`);
    }
  }

  if (!Number.isInteger(Math.log2(options.N))) throw new Error('--n must be a power of two');
  if (options.kdfIterations > 20) throw new Error('--kdf-iterations must be 20 or less');
  if (options.runs > 20) throw new Error('--runs must be 20 or less');
  return options;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) throw new Error('Cannot calculate a median without measurements');
  if (sorted.length % 2 === 1) return upper;

  const lower = sorted[middle - 1];
  if (lower === undefined) throw new Error('Cannot calculate a median without measurements');
  return (lower + upper) / 2;
}

export async function runKdfBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const durationsMs: number[] = [];
  const rssBefore = process.memoryUsage.rss();
  let peakRss = rssBefore;
  const memorySampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage.rss());
  }, 5);

  try {
    for (let run = 0; run < options.runs; run++) {
      const startedAt = performance.now();
      const key =
        options.algorithm === 'argon2id'
          ? await argon2id({
              password: BENCHMARK_PASSWORD,
              salt: BENCHMARK_SALT,
              memorySize: options.memorySize,
              iterations: options.kdfIterations,
              parallelism: options.parallelism,
              hashLength: options.dkLen,
              outputType: 'binary',
            })
          : await scrypt({
              password: BENCHMARK_PASSWORD,
              salt: BENCHMARK_SALT,
              costFactor: options.N,
              blockSize: options.r,
              parallelism: options.p,
              hashLength: options.dkLen,
              outputType: 'binary',
            });
      key.fill(0);
      durationsMs.push(Number((performance.now() - startedAt).toFixed(2)));
      peakRss = Math.max(peakRss, process.memoryUsage.rss());
    }
  } finally {
    clearInterval(memorySampler);
  }

  const endingRssDeltaMiB = (process.memoryUsage.rss() - rssBefore) / 1024 / 1024;
  const peakRssDeltaMiB = (peakRss - rssBefore) / 1024 / 1024;
  const cpuList = cpus();
  const parameters =
    options.algorithm === 'argon2id'
      ? {
          memorySize: options.memorySize,
          iterations: options.kdfIterations,
          parallelism: options.parallelism,
          dkLen: options.dkLen,
          runs: options.runs,
        }
      : {
          N: options.N,
          r: options.r,
          p: options.p,
          dkLen: options.dkLen,
          runs: options.runs,
          maxmem: options.maxmem,
        };

  return {
    algorithm: options.algorithm,
    runtime: {
      bun: Bun.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpuList[0]?.model ?? 'unknown',
      logicalCpus: cpuList.length,
      totalMemoryMiB: Math.round(totalmem() / 1024 / 1024),
    },
    parameters,
    durationsMs,
    minMs: Math.min(...durationsMs),
    medianMs: median(durationsMs),
    maxMs: Math.max(...durationsMs),
    peakRssDeltaMiB: Number(peakRssDeltaMiB.toFixed(2)),
    endingRssDeltaMiB: Number(endingRssDeltaMiB.toFixed(2)),
  };
}

function printHumanResult(result: BenchmarkResult): void {
  console.log(
    `${result.algorithm} ${Object.entries(result.parameters)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')}`,
  );
  console.log(
    `${result.runtime.platform} ${result.runtime.arch}, Bun ${result.runtime.bun}, ${result.runtime.cpu}`,
  );
  console.log(`runs: ${result.durationsMs.map((duration) => `${duration} ms`).join(', ')}`);
  console.log(`median: ${result.medianMs} ms, range: ${result.minMs}-${result.maxMs} ms`);
  console.log(`RSS: peak +${result.peakRssDeltaMiB} MiB, ending +${result.endingRssDeltaMiB} MiB`);
}

if (import.meta.main) {
  try {
    const options = parseBenchmarkOptions(process.argv.slice(2));
    const result = await runKdfBenchmark(options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printHumanResult(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`KDF benchmark failed: ${message}`);
    process.exitCode = 1;
  }
}
