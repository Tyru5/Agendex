import type { AgendexConfig } from '@agendex/shared';
import { CLI_DAEMON_STALE_AFTER_MS } from '@agendex/shared/daemon-status';
import type { DeviceInfo } from './api.ts';
import type { DaemonPidInfo } from './pid.ts';

export interface CloudDaemonStatusError {
  kind: 'auth-expired' | 'unavailable';
  message?: string;
}

export interface RenderStatusOptions {
  config: AgendexConfig | null;
  configPath: string;
  pidInfo: DaemonPidInfo | null;
  running: boolean;
  cliVersion: string;
  devices?: DeviceInfo[] | null;
  cloudDaemonError?: CloudDaemonStatusError | null;
  now?: number;
  color?: boolean;
}

type StatusKind = 'success' | 'warning' | 'danger' | 'info' | 'muted';

interface StatusStyles {
  title(text: string): string;
  section(text: string): string;
  key(text: string): string;
  value(text: string): string;
  muted(text: string): string;
  status(kind: StatusKind, text: string): string;
}

const LABEL_WIDTH = 18;
const ACTION_WIDTH = 26;

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  gray: '\u001b[90m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  blue: '\u001b[34m',
};

function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

function paint(enabled: boolean, code: string, text: string): string {
  return enabled ? `${code}${text}${ANSI.reset}` : text;
}

function createStyles(color: boolean): StatusStyles {
  return {
    title: (text) => paint(color, `${ANSI.bold}${ANSI.cyan}`, text),
    section: (text) => paint(color, ANSI.yellow, text),
    key: (text) => paint(color, ANSI.green, text),
    value: (text) => text,
    muted: (text) => paint(color, ANSI.gray, text),
    status(kind, text) {
      if (kind === 'success') return paint(color, ANSI.green, text);
      if (kind === 'warning') return paint(color, ANSI.yellow, text);
      if (kind === 'danger') return paint(color, ANSI.red, text);
      if (kind === 'info') return paint(color, ANSI.blue, text);
      return paint(color, ANSI.gray, text);
    },
  };
}

function badge(styles: StatusStyles, kind: Exclude<StatusKind, 'muted'>, label: string): string {
  let icon = '•';
  if (kind === 'success') icon = '✓';
  else if (kind === 'warning') icon = '!';
  else if (kind === 'danger') icon = '×';
  return styles.status(kind, `${icon} ${label}`);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function row(styles: StatusStyles, label: string, status: string, detail?: string): string {
  const labelCell = styles.key(label.padEnd(LABEL_WIDTH));
  const suffix = detail ? `  ${styles.muted(detail)}` : '';
  return `  ${labelCell}${status}${suffix}`;
}

function actionRow(styles: StatusStyles, command: string, description: string): string {
  return `  ${styles.key(command.padEnd(ACTION_WIDTH))}${description}`;
}

function listItem(styles: StatusStyles, value: string): string {
  return `    ${styles.muted('•')} ${value}`;
}

function summarizeList(items: string[], maxItems = 4): string {
  if (items.length === 0) return '';
  if (items.length <= maxItems) return items.join(', ');
  const visible = items.slice(0, maxItems).join(', ');
  return `${visible} +${items.length - maxItems} more`;
}

export function formatDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  const seconds = Math.floor(safeMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remainingMinutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}

function localDaemonDetail(options: RenderStatusOptions, now: number): string {
  if (!options.running) return 'run `agendex start` to begin background sync';

  const parts: string[] = [];
  if (isPresent(options.pidInfo?.pid)) parts.push(`PID ${options.pidInfo.pid}`);
  if (isPresent(options.pidInfo?.startedAtMs)) {
    parts.push(`up ${formatDuration(now - options.pidInfo.startedAtMs)}`);
  } else {
    parts.push('uptime unknown');
  }
  if (options.pidInfo?.hostname) parts.push(`host ${options.pidInfo.hostname}`);
  else parts.push('host unknown');
  return parts.join(' • ');
}

function isDeviceAlive(device: DeviceInfo, now: number): boolean {
  if (!isPresent(device.lastSeenAt)) return false;
  return now - device.lastSeenAt < CLI_DAEMON_STALE_AFTER_MS;
}

function sortDevices(devices: DeviceInfo[], localDeviceId: string | undefined, now: number) {
  return [...devices].sort((a, b) => {
    const localDiff = Number(b.deviceId === localDeviceId) - Number(a.deviceId === localDeviceId);
    if (localDiff !== 0) return localDiff;

    const aliveDiff = Number(isDeviceAlive(b, now)) - Number(isDeviceAlive(a, now));
    if (aliveDiff !== 0) return aliveDiff;

    return (a.hostname ?? '').localeCompare(b.hostname ?? '');
  });
}

interface DeviceLineOptions {
  styles: StatusStyles;
  device: DeviceInfo;
  localDeviceId: string | undefined;
  now: number;
}

function deviceLines({ styles, device, localDeviceId, now }: DeviceLineOptions): string[] {
  const alive = isDeviceAlive(device, now);
  const statusText = alive ? '✓ alive' : '! stale';
  const statusCell = styles.status(alive ? 'success' : 'warning', statusText.padEnd(12));
  const hostname = device.hostname ?? 'unknown host';
  const isLocalDevice = localDeviceId !== undefined && device.deviceId === localDeviceId;
  const localMarker = isLocalDevice ? ' (this machine)' : '';
  const pid = isPresent(device.pid) ? `PID ${device.pid}` : 'PID unknown';
  const uptime = isPresent(device.startedAtMs)
    ? `up ${formatDuration(now - device.startedAtMs)}`
    : 'uptime unknown';
  const seen = isPresent(device.lastSeenAt)
    ? `seen ${formatDuration(now - device.lastSeenAt)} ago`
    : 'last seen unknown';
  const ip = device.ipAddress ?? 'IP unknown';

  return [
    `  ${statusCell}${styles.value(hostname)}${styles.muted(localMarker)}`,
    `              ${styles.muted([pid, uptime, seen, ip].join(' • '))}`,
  ];
}

interface CloudDaemonLinesOptions {
  lines: string[];
  styles: StatusStyles;
  options: RenderStatusOptions;
  cloudReady: boolean;
  now: number;
}

function addCloudDaemonLines({ lines, styles, options, cloudReady, now }: CloudDaemonLinesOptions) {
  if (!cloudReady) {
    lines.push(
      row(styles, 'Daemon registry', badge(styles, 'warning', 'offline'), 'login required'),
    );
    return;
  }

  if (options.cloudDaemonError?.kind === 'auth-expired') {
    lines.push(
      row(
        styles,
        'Daemon registry',
        badge(styles, 'danger', 'token expired'),
        'run `agendex login`',
      ),
    );
    return;
  }

  if (options.cloudDaemonError?.kind === 'unavailable') {
    lines.push(
      row(
        styles,
        'Daemon registry',
        badge(styles, 'warning', 'unavailable'),
        options.cloudDaemonError.message ?? 'will retry on the next status check',
      ),
    );
    return;
  }

  const devices = options.devices ?? [];
  if (devices.length === 0) {
    lines.push(
      row(styles, 'Daemon registry', badge(styles, 'info', 'empty'), 'no cloud daemons reported'),
    );
    return;
  }

  const aliveCount = devices.filter((device) => isDeviceAlive(device, now)).length;
  const staleCount = devices.length - aliveCount;
  lines.push(
    row(
      styles,
      'Daemon registry',
      badge(styles, 'success', `${devices.length} device${devices.length === 1 ? '' : 's'}`),
      `${aliveCount} alive • ${staleCount} stale`,
    ),
  );

  const localDeviceId = options.config?.deviceId;
  for (const device of sortDevices(devices, localDeviceId, now)) {
    lines.push(...deviceLines({ styles, device, localDeviceId, now }));
  }
}

function nextActions(
  options: RenderStatusOptions,
  now: number,
): { command: string; description: string }[] {
  const config = options.config;
  const cloudReady = Boolean(config?.cloudToken && config.convexUrl);
  const adapters = config?.enabledAdapters ?? [];
  const devices = options.devices ?? [];
  const hasStaleDevices = devices.some((device) => !isDeviceAlive(device, now));
  const authExpired = options.cloudDaemonError?.kind === 'auth-expired';

  const actions: { command: string; description: string }[] = [];
  if (!options.running) {
    actions.push({ command: 'agendex start', description: 'Start the background sync daemon' });
  }
  if (!cloudReady || authExpired) {
    actions.push({ command: 'agendex login', description: 'Connect or refresh cloud sync' });
  }
  if (adapters.length === 0) {
    actions.push({
      command: 'agendex configure',
      description: 'Choose which agent plan sources to index',
    });
  }
  if (hasStaleDevices) {
    actions.push({
      command: 'agendex cleanup --stale',
      description: 'Remove stale cloud daemon records',
    });
  }
  if (cloudReady) {
    actions.push({
      command: 'agendex sync',
      description: 'Run a one-shot scan and cloud sync now',
    });
  }
  actions.push({ command: 'agendex open', description: 'Open the Agendex dashboard' });

  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.command)) return false;
    seen.add(action.command);
    return true;
  });
}

export function renderStatus(options: RenderStatusOptions): string {
  const styles = createStyles(options.color ?? supportsColor());
  const now = options.now ?? Date.now();
  const config = options.config;
  const adapters = config?.enabledAdapters ?? [];
  const customDirs = config?.customPlanDirs ?? [];
  const cloudReady = Boolean(config?.cloudToken && config.convexUrl);
  const lines: string[] = [];

  lines.push(styles.title('Agendex status'));
  lines.push(styles.muted(`Config: ${options.configPath}`));
  lines.push('');

  lines.push(styles.section('Local:'));
  lines.push(
    row(
      styles,
      'Daemon',
      options.running
        ? badge(styles, 'success', 'running')
        : badge(styles, 'warning', 'not running'),
      localDaemonDetail(options, now),
    ),
  );
  lines.push(
    row(
      styles,
      'Config file',
      config ? badge(styles, 'success', 'found') : badge(styles, 'warning', 'missing'),
      config ? `v${config.configVersion}` : 'created on first start/configure',
    ),
  );
  lines.push(
    row(
      styles,
      'Local API token',
      config?.token ? badge(styles, 'success', 'set') : badge(styles, 'warning', 'missing'),
      config?.token ? 'ready for OSS API auth' : 'generated when the local app starts',
    ),
  );
  lines.push(row(styles, 'CLI version', styles.value(`v${options.cliVersion}`)));
  lines.push('');

  lines.push(styles.section('Cloud:'));
  lines.push(
    row(
      styles,
      'Account',
      cloudReady
        ? badge(styles, 'success', 'logged in')
        : badge(styles, 'warning', 'not logged in'),
      config?.convexUrl ?? 'run `agendex login` to enable cloud sync',
    ),
  );
  if (config?.siteUrl) {
    lines.push(row(styles, 'Web app', styles.value(config.siteUrl)));
  }
  lines.push(
    row(
      styles,
      'Device ID',
      config?.deviceId
        ? badge(styles, 'success', 'registered')
        : badge(styles, 'warning', 'missing'),
      config?.deviceId ?? 'created on the next daemon heartbeat',
    ),
  );
  addCloudDaemonLines({ lines, styles, options, cloudReady, now });
  lines.push('');

  lines.push(styles.section('Plan sources:'));
  lines.push(
    row(
      styles,
      'Adapters',
      adapters.length > 0
        ? badge(styles, 'success', `${adapters.length} enabled`)
        : badge(styles, 'warning', 'none enabled'),
      adapters.length > 0 ? summarizeList(adapters) : 'run `agendex configure`',
    ),
  );
  lines.push(
    row(
      styles,
      'Custom dirs',
      customDirs.length > 0
        ? badge(styles, 'info', `${customDirs.length} configured`)
        : badge(styles, 'info', 'none'),
      customDirs.length > 0 ? 'additional scan roots' : 'using built-in agent directories',
    ),
  );
  for (const dir of customDirs) lines.push(listItem(styles, dir));
  lines.push('');

  lines.push(styles.section('Next steps:'));
  for (const action of nextActions(options, now)) {
    lines.push(actionRow(styles, action.command, action.description));
  }

  return lines.join('\n');
}
