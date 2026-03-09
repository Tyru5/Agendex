import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(__dirname, '..');
const repoRoot = resolve(packageDir, '../..');
const distDir = join(packageDir, 'dist');
const distFile = join(distDir, 'cli.js');
const releaseDir = join(packageDir, '.release');
const releaseDistDir = join(releaseDir, 'dist');
const distOnly = process.argv.includes('--dist-only');

await buildDist();

if (!distOnly) {
  await buildRelease();
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function buildDist() {
  await rm(distDir, { force: true, recursive: true });
  await mkdir(distDir, { recursive: true });

  run(
    'bun',
    [
      'build',
      './src/cli.ts',
      '--target',
      'node',
      '--format',
      'esm',
      '--external',
      'better-sqlite3',
      '--outfile',
      './dist/cli.js',
    ],
    packageDir,
  );

  await chmod(distFile, 0o755);
}

async function buildRelease() {
  await rm(releaseDir, { force: true, recursive: true });
  await mkdir(releaseDistDir, { recursive: true });

  const [cliManifest, sharedManifest] = await Promise.all([
    readJson(join(packageDir, 'package.json')),
    readJson(join(repoRoot, 'packages', 'shared', 'package.json')),
  ]);

  await Promise.all([
    copyFile(distFile, join(releaseDistDir, 'cli.js')),
    copyFile(join(packageDir, 'README.md'), join(releaseDir, 'README.md')),
    copyFile(join(repoRoot, 'LICENSE'), join(releaseDir, 'LICENSE')),
  ]);
  await chmod(join(releaseDistDir, 'cli.js'), 0o755);

  const dependencyNames = ['better-sqlite3'];
  const dependencies = Object.fromEntries(
    dependencyNames
      .map((name) => [
        name,
        cliManifest.dependencies?.[name] ?? sharedManifest.dependencies?.[name],
      ])
      .filter(([, version]) => typeof version === 'string'),
  );

  const releaseManifest = {
    name: cliManifest.name,
    version: cliManifest.version,
    description: cliManifest.description,
    homepage: cliManifest.homepage,
    repository: cliManifest.repository,
    bugs: cliManifest.bugs,
    license: cliManifest.license,
    type: 'module',
    bin: {
      agendex: './dist/cli.js',
    },
    files: ['dist', 'README.md', 'LICENSE'],
    publishConfig: {
      access: 'public',
    },
    engines: {
      node: '>=20',
    },
    ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
  };

  await writeFile(
    join(releaseDir, 'package.json'),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf-8'));
}
