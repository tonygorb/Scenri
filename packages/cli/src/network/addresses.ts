/**
 * Which of this machine's addresses a phone on the same Wi-Fi can open.
 *
 * A laptop carries many: Wi-Fi, Ethernet, a VPN tunnel, Docker and VM
 * bridges, Tailscale, the loopback. Only the first two are the network the
 * phone is on, and handing someone a VPN or Docker address is a QR code that
 * never opens. So: private IPv4 only (a URL a person can type, no IPv6 scope
 * ids), never an adapter whose name says it is a tunnel or a virtual switch,
 * and the address the default route leaves through first, because that is
 * the network this machine is actually using.
 */
import { createSocket } from 'node:dgram';
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

/**
 * Adapter names that are never the Wi-Fi or Ethernet a phone shares: tunnels
 * (utun, tun, wg, ppp, ipsec), VPN and overlay clients, container and VM
 * switches, and macOS's peer-to-peer radios. Windows names adapters by what
 * they are ("vEthernet (WSL)", "VirtualBox Host-Only Network"), so the same
 * words catch them there.
 */
const VIRTUAL =
  /^(utun|tun|tap|ppp|ipsec|wg|zt|gif|stf|awdl|llw|anpi|bridge|docker|br-|veth|virbr|vmnet|vboxnet|lxc|lxd|cni|flannel|cali|tailscale)|virtual|vmware|hyper-v|vethernet|wsl|tailscale|zerotier|wireguard|openvpn|nordlynx|tap-windows|bluetooth|loopback/i;

/** Names that read as a real Wi-Fi or Ethernet port on macOS, Linux and Windows. */
const PHYSICAL = /^(en\d|eth\d|wl|wlan|enp|eno|ens|wi-?fi|wlan|ethernet|wireless)/i;

function octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  return nums.every((n, i) => /^\d{1,3}$/.test(parts[i]) && n >= 0 && n <= 255) ? nums : null;
}

/**
 * Lower is better; null is not a network a phone can share. 100.64/10 is the
 * carrier range Tailscale also lives in, so it only counts on an adapter that
 * already passed the name check, and last.
 */
function rangeRank(address: string): number | null {
  const o = octets(address);
  if (!o) return null;
  if (o[0] === 192 && o[1] === 168) return 0;
  if (o[0] === 10) return 1;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return 2;
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return 3;
  return null;
}

const isIPv4 = (a: NetworkInterfaceInfo) =>
  (a.family as string | number) === 'IPv4' || (a.family as string | number) === 4;

/**
 * Every address a phone could open, best first, deduplicated. Pure: the
 * interfaces and the default route's address come in, so a test can hand it
 * any machine.
 */
export function lanCandidates(ifaces: Interfaces, routeAddress: string | null = null): string[] {
  const found: { address: string; name: string; physical: boolean; range: number }[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) {
      if (!isIPv4(a) || a.internal) continue;
      // a tunnel on Windows often has no hardware address at all
      if (a.mac === '00:00:00:00:00:00' && !PHYSICAL.test(name)) continue;
      const range = rangeRank(a.address);
      if (range === null) continue;
      found.push({ address: a.address, name, physical: PHYSICAL.test(name), range });
    }
  }
  found.sort(
    (a, b) =>
      Number(b.address === routeAddress) - Number(a.address === routeAddress) ||
      Number(b.physical) - Number(a.physical) ||
      a.range - b.range ||
      a.name.localeCompare(b.name) ||
      a.address.localeCompare(b.address, undefined, { numeric: true }),
  );
  return [...new Set(found.map((f) => f.address))];
}

/**
 * The address this machine's default route leaves from. A UDP connect only
 * asks the kernel for a route: no packet is sent, nothing leaves the machine.
 * 192.0.2.1 is a documentation address, so the answer is always the default
 * route and never a real host. Null offline, or when anything goes wrong.
 */
export function defaultRouteAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    let socket: ReturnType<typeof createSocket> | null = null;
    const done = (value: string | null) => {
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
      socket = null;
      resolve(value);
    };
    try {
      socket = createSocket('udp4');
      socket.once('error', () => done(null));
      socket.connect(9, '192.0.2.1', () => {
        try {
          done(socket?.address().address ?? null);
        } catch {
          done(null);
        }
      });
      setTimeout(() => done(null), 500).unref();
    } catch {
      done(null);
    }
  });
}

/** The machine's phone addresses right now. Never throws: no network is an empty list. */
export async function phoneAddresses(): Promise<string[]> {
  let ifaces: Interfaces = {};
  try {
    ifaces = networkInterfaces();
  } catch {
    return [];
  }
  return lanCandidates(ifaces, await defaultRouteAddress());
}

/** Every address this machine answers on, loopback included: a visit from one of these is this computer. */
export function ownAddresses(): Set<string> {
  const out = new Set<string>();
  try {
    for (const addrs of Object.values(networkInterfaces())) for (const a of addrs ?? []) out.add(a.address);
  } catch {
    /* no interfaces to read */
  }
  return out;
}
