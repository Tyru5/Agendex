import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { platform } from 'node:process';
import type { NetworkInterfaceInfo } from 'node:os';

type InterfaceMap = ReturnType<typeof networkInterfaces>;

type DefaultIpv4Route = {
  interfaceName?: string;
  sourceAddress?: string;
};

type LocalIpAddressOptions = {
  interfaces?: InterfaceMap;
  defaultRoute?: DefaultIpv4Route | null;
};

export const DISABLE_LOCAL_IP_ENV = 'AGENDEX_DISABLE_LOCAL_IP';

export function shouldCollectLocalIpAddress(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[DISABLE_LOCAL_IP_ENV]?.trim().toLowerCase();
  return !['1', 'true', 'yes', 'on'].includes(value ?? '');
}

/**
 * Returns the machine's primary non-internal IPv4 address, or `undefined` when
 * no such interface is available (e.g. fully offline). IPv6-only hosts fall
 * back to the first non-internal IPv6 address. Used to stamp sync provenance
 * onto plans so the UI can show *where* a plan was synced from.
 */
export function getLocalIpAddress(options: LocalIpAddressOptions = {}): string | undefined {
  const interfaces = options.interfaces ?? networkInterfaces();
  const route = options.defaultRoute === undefined ? getDefaultIpv4Route() : options.defaultRoute;
  const routedAddress = route ? getAddressForRoute(interfaces, route) : undefined;

  return (
    routedAddress ?? findFirstAddress(interfaces, 'IPv4') ?? findFirstAddress(interfaces, 'IPv6')
  );
}

function getAddressForRoute(interfaces: InterfaceMap, route: DefaultIpv4Route): string | undefined {
  if (route.sourceAddress && isUsableIpv4Address(route.sourceAddress)) return route.sourceAddress;
  if (route.interfaceName) return findFirstAddress(interfaces, 'IPv4', route.interfaceName);
  return undefined;
}

function findFirstAddress(
  interfaces: InterfaceMap,
  family: NetworkInterfaceInfo['family'],
  interfaceName?: string,
): string | undefined {
  const entries = interfaceName
    ? ([[interfaceName, interfaces[interfaceName]]] as const)
    : Object.entries(interfaces).sort(([left], [right]) => left.localeCompare(right));

  for (const [, addrs] of entries) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      if (addr.family === family) return addr.address;
    }
  }

  return undefined;
}

function getDefaultIpv4Route(): DefaultIpv4Route | undefined {
  switch (platform) {
    case 'linux':
      return parseLinuxRoute(readRouteCommand('ip', ['route', 'get', '1.1.1.1']));
    case 'darwin':
    case 'freebsd':
    case 'netbsd':
    case 'openbsd':
      return parseBsdRoute(readRouteCommand('route', ['-n', 'get', '1.1.1.1']));
    case 'win32':
      return getWindowsDefaultRouteAddress();
    default:
      return undefined;
  }
}

function readRouteCommand(command: string, args: string[]): string | undefined {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    });
  } catch {
    return undefined;
  }
}

function parseLinuxRoute(output: string | undefined): DefaultIpv4Route | undefined {
  if (!output) return undefined;
  return buildRoute({
    interfaceName: output.match(/\bdev\s+(\S+)/)?.[1],
    sourceAddress: output.match(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1],
  });
}

function parseBsdRoute(output: string | undefined): DefaultIpv4Route | undefined {
  if (!output) return undefined;
  return buildRoute({
    interfaceName: output.match(/^\s*interface:\s+(\S+)/m)?.[1],
  });
}

function getWindowsDefaultRouteAddress(): DefaultIpv4Route | undefined {
  const script = [
    "$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0'",
    '| Sort-Object -Property @{ Expression = { $_.RouteMetric + $_.InterfaceMetric } }',
    '| Select-Object -First 1;',
    'if ($route) {',
    'Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex',
    "| Where-Object { $_.IPAddress -notlike '169.254.*' }",
    '| Select-Object -First 1 -ExpandProperty IPAddress',
    '}',
  ].join(' ');
  const output = readRouteCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  const sourceAddress = output
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(isUsableIpv4Address);

  return buildRoute({ sourceAddress });
}

function buildRoute(route: DefaultIpv4Route): DefaultIpv4Route | undefined {
  return route.interfaceName || route.sourceAddress ? route : undefined;
}

function isUsableIpv4Address(address: string): boolean {
  if (!isIpv4Address(address)) return false;
  return address !== '0.0.0.0' && !address.startsWith('127.');
}

function isIpv4Address(address: string): boolean {
  const octets = address.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^\d+$/.test(octet)) return false;
      const value = Number(octet);
      return value >= 0 && value <= 255;
    })
  );
}
