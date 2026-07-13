import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

function requestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolvePromise(body));
    req.on('error', reject);
  });
}

test('remove-dir --live authenticates with AGENDEX_TOKEN when config has another token', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-cli-'));
  const configDir = join(tempRoot, '.agendex-test');
  const planDir = join(tempRoot, 'plans');
  await mkdir(configDir, { recursive: true });
  await mkdir(planDir);
  await writeFile(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        configVersion: 3,
        token: 'persisted-token',
        enabledAdapters: [],
        customPlanDirs: [planDir],
      },
      null,
      2,
    ),
  );

  let requestAuthorization = '';
  let requestMethod = '';
  let requestPayload = '';
  const server = createServer(async (req, res) => {
    requestAuthorization = req.headers.authorization ?? '';
    requestMethod = req.method ?? '';
    requestPayload = await requestBody(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ customPlanDirs: [] }));
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, resolvePromise);
  });

  try {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP server address');
    }

    const proc = Bun.spawn({
      cmd: ['bun', 'packages/cli/src/cli.ts', 'remove-dir', planDir, '--live'],
      env: {
        ...process.env,
        AGENDEX_CONFIG_DIR: configDir,
        AGENDEX_TOKEN: 'env-token',
        PORT: String(address.port),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('[agendex] removed custom plan dir:');
    expect(requestMethod).toBe('DELETE');
    expect(requestAuthorization).toBe('Bearer env-token');
    expect(JSON.parse(requestPayload)).toEqual({ path: planDir });
  } finally {
    server.close();
  }
});

test('sync --help renders help without running sync', async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'agendex-cli-help-'));
  const configDir = join(tempRoot, '.agendex-test');

  const proc = Bun.spawn({
    cmd: ['bun', 'packages/cli/src/cli.ts', 'sync', '--help'],
    env: {
      ...process.env,
      HOME: tempRoot,
      AGENDEX_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe('');
  expect(stdout).toContain('Usage: agendex [OPTIONS] [COMMAND]');
  expect(stdout).not.toContain('[agendex] Scanning local plans...');
  expect(await Bun.file(join(configDir, 'config.json')).exists()).toBe(false);
});
