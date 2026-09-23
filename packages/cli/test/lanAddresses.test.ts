import { describe, it, expect } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { defaultRouteAddress, lanCandidates } from '../src/network/addresses.js';

const v4 = (address: string, mac = 'a4:83:e7:11:22:33', internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac,
  internal,
  cidr: `${address}/24`,
});
const v6 = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: 'a4:83:e7:11:22:33',
  internal: false,
  cidr: `${address}/64`,
  scopeid: 0,
});
const lo = { lo0: [v4('127.0.0.1', '00:00:00:00:00:00', true)] };

describe('lanCandidates', () => {
  it('a Mac on Wi-Fi with a VPN, Internet Sharing and AirDrop: the Wi-Fi only', () => {
    const mac = {
      ...lo,
      en0: [v6('fe80::1'), v4('192.168.1.221')],
      utun4: [v4('10.8.0.2', '00:00:00:00:00:00')],
      bridge100: [v4('192.168.2.1')],
      awdl0: [v6('fe80::2')],
    };
    expect(lanCandidates(mac)).toEqual(['192.168.1.221']);
  });

  it('Windows with WSL, VirtualBox and a VPN adapter: the Wi-Fi only', () => {
    const win = {
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1', '00:00:00:00:00:00', true)],
      'Wi-Fi': [v4('192.168.0.14')],
      'vEthernet (WSL)': [v4('172.29.16.1')],
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
      'OpenVPN Wintun': [v4('10.9.0.6')],
      'Bluetooth Network Connection': [v4('169.254.10.10')],
    };
    expect(lanCandidates(win)).toEqual(['192.168.0.14']);
  });

  it('Linux with Docker, Tailscale and libvirt: the Wi-Fi only', () => {
    const linux = {
      lo: [v4('127.0.0.1', '00:00:00:00:00:00', true)],
      wlp2s0: [v4('10.0.0.23')],
      docker0: [v4('172.17.0.1')],
      'br-3f2a': [v4('172.18.0.1')],
      tailscale0: [v4('100.101.102.103')],
      virbr0: [v4('192.168.122.1')],
    };
    expect(lanCandidates(linux)).toEqual(['10.0.0.23']);
  });

  it('Wi-Fi and Ethernet together: both, in a stable order', () => {
    const both = { ...lo, en1: [v4('192.168.1.30')], en0: [v4('192.168.1.31')] };
    expect(lanCandidates(both)).toEqual(['192.168.1.31', '192.168.1.30']);
    expect(lanCandidates(both)).toEqual(lanCandidates({ en0: both.en0, en1: both.en1, ...lo }));
  });

  it('puts the address the default route leaves from first', () => {
    const both = { ...lo, en0: [v4('192.168.1.31')], en7: [v4('10.0.0.9')] };
    expect(lanCandidates(both, '10.0.0.9')).toEqual(['10.0.0.9', '192.168.1.31']);
  });

  it('never trusts the default route when it runs through a tunnel', () => {
    const vpn = { ...lo, en0: [v4('192.168.1.31')], utun3: [v4('10.8.0.2', '00:00:00:00:00:00')] };
    expect(lanCandidates(vpn, '10.8.0.2')).toEqual(['192.168.1.31']);
  });

  it('prefers a home network range over the ranges VMs and containers borrow', () => {
    const odd = { ...lo, eth1: [v4('172.20.10.2')], eth0: [v4('192.168.8.4')], eth2: [v4('10.0.0.4')] };
    expect(lanCandidates(odd)).toEqual(['192.168.8.4', '10.0.0.4', '172.20.10.2']);
  });

  it('an iPhone hotspot is a network like any other', () => {
    expect(lanCandidates({ ...lo, en0: [v4('172.20.10.3')] })).toEqual(['172.20.10.3']);
  });

  it('no network: nothing, not the loopback', () => {
    expect(lanCandidates(lo)).toEqual([]);
    expect(lanCandidates({})).toEqual([]);
  });

  it('skips link-local, public and IPv6-only addresses', () => {
    const odd = { ...lo, en0: [v4('169.254.3.4'), v6('2a0d:6fc2::1')], en1: [v4('8.8.4.4')] };
    expect(lanCandidates(odd)).toEqual([]);
  });

  it('reads the numeric family older Node reported', () => {
    const old = { en0: [{ ...v4('192.168.1.5'), family: 4 as unknown as 'IPv4' }] };
    expect(lanCandidates(old)).toEqual(['192.168.1.5']);
  });
});

describe('defaultRouteAddress', () => {
  it('answers with an address or nothing, and never throws', async () => {
    const got = await defaultRouteAddress();
    expect(got === null || /^\d+\.\d+\.\d+\.\d+$/.test(got)).toBe(true);
  });
});
