import { expect, test } from 'bun:test';
import type { NetworkInterfaceInfo } from 'node:os';
import { getLocalIpAddress } from './network.ts';

function ipv4(address: string): NetworkInterfaceInfo {
  return {
    address,
    cidr: `${address}/24`,
    family: 'IPv4',
    internal: false,
    mac: '00:00:00:00:00:00',
    netmask: '255.255.255.0',
  };
}

function ipv6(address: string): NetworkInterfaceInfo {
  return {
    address,
    cidr: `${address}/64`,
    family: 'IPv6',
    internal: false,
    mac: '00:00:00:00:00:00',
    netmask: 'ffff:ffff:ffff:ffff::',
    scopeid: 0,
  };
}

test('getLocalIpAddress prefers the default route source address', () => {
  const ipAddress = getLocalIpAddress({
    interfaces: {
      docker0: [ipv4('172.17.0.1')],
      tun0: [ipv4('10.8.0.2')],
      wlan0: [ipv4('192.168.1.24')],
    },
    defaultRoute: { interfaceName: 'wlan0', sourceAddress: '192.168.1.24' },
  });

  expect(ipAddress).toBe('192.168.1.24');
});

test('getLocalIpAddress uses the default route interface when no source address is reported', () => {
  const ipAddress = getLocalIpAddress({
    interfaces: {
      docker0: [ipv4('172.17.0.1')],
      tun0: [ipv4('10.8.0.2')],
      wlan0: [ipv4('192.168.1.24')],
    },
    defaultRoute: { interfaceName: 'wlan0' },
  });

  expect(ipAddress).toBe('192.168.1.24');
});

test('getLocalIpAddress falls back to IPv6 when no IPv4 address is available', () => {
  const ipAddress = getLocalIpAddress({
    interfaces: {
      wlan0: [ipv6('2001:db8::24')],
    },
    defaultRoute: null,
  });

  expect(ipAddress).toBe('2001:db8::24');
});
