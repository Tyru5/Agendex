import { existsSync, writeFileSync } from 'node:fs';
import { acquireDaemonStartLock } from '../src/pid.ts';

const [configDir, goPath, releasePath, resultPath] = process.argv.slice(2);
if (!configDir || !goPath || !releasePath || !resultPath) {
  throw new Error('Expected configDir, goPath, releasePath, and resultPath');
}

while (!existsSync(goPath)) await Bun.sleep(5);

const release = acquireDaemonStartLock({ configDir });
writeFileSync(resultPath, release ? 'acquired' : 'blocked');

if (release) {
  while (!existsSync(releasePath)) await Bun.sleep(5);
  release();
}
