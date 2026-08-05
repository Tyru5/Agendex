/**
 * Open-in catalog for jump-to-source: detect locally installed targets and
 * build argv launch commands. Launching is always argv-based — no shell
 * string interpolation.
 */
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export type OpenInAppKind = 'editor' | 'file-manager';

export interface OpenInApp {
  id: string;
  label: string;
  kind: OpenInAppKind;
}

interface EditorDefinition {
  id: string;
  label: string;
  /** CLI binary names probed on PATH (line-aware launch). */
  bins: string[];
  /** macOS application bundle fallback when the CLI binary is missing. */
  macApp?: string;
  /** Build argv given the CLI binary, file path, and optional line. */
  argv: (bin: string, filePath: string, line?: number) => string[];
}

const EDITORS: EditorDefinition[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    bins: ['cursor'],
    macApp: 'Cursor.app',
    argv: (bin, filePath, line) =>
      line !== undefined ? [bin, '-g', `${filePath}:${line}`] : [bin, filePath],
  },
  {
    id: 'vscode',
    label: 'VS Code',
    bins: ['code'],
    macApp: 'Visual Studio Code.app',
    argv: (bin, filePath, line) =>
      line !== undefined ? [bin, '-g', `${filePath}:${line}`] : [bin, filePath],
  },
  {
    id: 'zed',
    label: 'Zed',
    bins: ['zed'],
    macApp: 'Zed.app',
    argv: (bin, filePath, line) =>
      line !== undefined ? [bin, `${filePath}:${line}`] : [bin, filePath],
  },
];

const MAC_APP_DIRS = ['/Applications', join(process.env.HOME ?? '', 'Applications')];

function findExecutable(name: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((ext) => ext.toLowerCase())
      : [''];

  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findMacApp(appName: string): string | null {
  if (process.platform !== 'darwin') return null;
  for (const dir of MAC_APP_DIRS) {
    const candidate = join(dir, appName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function fileManagerLabel(): string {
  if (process.platform === 'darwin') return 'Reveal in Finder';
  if (process.platform === 'win32') return 'Show in Explorer';
  return 'Open Containing Folder';
}

/** Host-filtered catalog: only targets that can actually launch here. */
export function detectOpenInApps(): OpenInApp[] {
  const apps: OpenInApp[] = [];

  for (const editor of EDITORS) {
    const bin = editor.bins.map(findExecutable).find(Boolean);
    if (bin || findMacApp(editor.macApp ?? '')) {
      apps.push({ id: editor.id, label: editor.label, kind: 'editor' });
    }
  }

  apps.push({ id: 'reveal', label: fileManagerLabel(), kind: 'file-manager' });
  return apps;
}

/**
 * Build the argv launch command for an app id and an already-resolved
 * absolute file path. Returns null when the app is not available.
 */
export function buildLaunchCommand(
  appId: string,
  filePath: string,
  line?: number,
): string[] | null {
  if (appId === 'reveal') {
    if (process.platform === 'darwin') return ['open', '-R', filePath];
    if (process.platform === 'win32') {
      // explorer re-parses /select,PATH; quote paths so spaces survive.
      return ['explorer', `/select,"${filePath}"`];
    }
    return ['xdg-open', dirname(filePath)];
  }

  const editor = EDITORS.find((entry) => entry.id === appId);
  if (!editor) return null;

  const bin = editor.bins.map(findExecutable).find((found): found is string => Boolean(found));
  if (bin) return editor.argv(bin, filePath, line);

  const macApp = findMacApp(editor.macApp ?? '');
  if (macApp) {
    if (line !== undefined) {
      // Bundle fallback normally cannot jump to a line; forward the CLI goto
      // flags via --args so advertised line support still works.
      const gotoArgs = editor.argv('__bin__', filePath, line).slice(1);
      return ['open', '-a', macApp, '--args', ...gotoArgs];
    }
    return ['open', '-a', macApp, filePath];
  }

  return null;
}
