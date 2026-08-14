import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;

export function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function startManagedProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  return {
    child,
    output: () => ({ stdout, stderr }),
    kill: () => {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

export async function waitForExit(managed, timeoutMs = 10_000) {
  if (managed.child.exitCode !== null) return managed.child.exitCode;
  return Promise.race([
    new Promise((resolveExit) => {
      managed.child.once('exit', (code) => resolveExit(code ?? 0));
    }),
    delay(timeoutMs).then(() => null),
  ]);
}

export async function waitForHttp(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = Date.now();
  let attempts = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    try {
      const response = await fetch(url);
      if (response.ok) return { ok: true, attempts };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await delay(250);
  }
  return { ok: false, attempts };
}

export async function connectToElectronPage(port, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = `http://127.0.0.1:${port}/json/list`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
        if (target) return connectCdp(target.webSocketDebuggerUrl);
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await delay(250);
  }
  throw new Error('No Electron page target exposed over CDP');
}

function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('CDP WebSocket closed'));
    pending.clear();
  });

  const opened = new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket failed')), {
      once: true,
    });
  });

  return {
    ready: opened,
    close: () => socket.close(),
    send: async (method, params = {}) => {
      await opened;
      const id = nextId;
      nextId += 1;
      const result = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }, DEFAULT_TIMEOUT_MS);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
  };
}

export async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.exception?.value ??
      result.exceptionDetails.text ??
      'Runtime.evaluate failed';
    throw new Error(String(description));
  }
  return result.result?.value;
}

export async function waitForEvaluation(
  client,
  expression,
  predicate,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  let lastValue = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await evaluate(client, expression);
    if (predicate(lastValue)) return lastValue;
    await delay(250);
  }
  throw new Error(`Timed out waiting for renderer state: ${JSON.stringify(lastValue)}`);
}

export async function captureScreenshot(client, path) {
  await client.send('Page.enable');
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
  await Bun.write(path, Buffer.from(screenshot.data, 'base64'));
}

export function findFile(root, fileName, maxDepth = 5) {
  function walk(dir, depth) {
    if (depth > maxDepth) return null;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return null;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isFile() && entry === fileName) return fullPath;
      if (stat.isDirectory()) {
        const found = walk(fullPath, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(root, 0);
}
