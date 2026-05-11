import { networkInterfaces } from 'node:os';

/**
 * Returns the machine's primary non-internal IPv4 address, or `undefined` when
 * no such interface is available (e.g. fully offline). IPv6-only hosts fall
 * back to the first non-internal IPv6 address. Used to stamp sync provenance
 * onto plans so the UI can show *where* a plan was synced from.
 */
export function getLocalIpAddress(): string | undefined {
  const interfaces = networkInterfaces();
  let ipv6Fallback: string | undefined;

  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      if (addr.family === 'IPv4') return addr.address;
      if (addr.family === 'IPv6' && !ipv6Fallback) ipv6Fallback = addr.address;
    }
  }

  return ipv6Fallback;
}
