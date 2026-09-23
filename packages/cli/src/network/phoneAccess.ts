/**
 * Opening Scenri on a phone, a tablet or another computer on the same Wi-Fi.
 *
 * The studio's own listener stays on 127.0.0.1, exactly as before, so a second
 * start still meets the first one and adopts it, and the desktop icon still
 * finds it. Beside it, one listener per address a phone can reach (Wi-Fi,
 * Ethernet), on the same port. Not 0.0.0.0: on macOS a wildcard listener can
 * sit beside another process's 127.0.0.1 one, so an older Scenri started
 * afterwards would open the same library twice without either noticing.
 *
 * Addresses change (another Wi-Fi, a sleep, a new lease), so the set is
 * checked again whenever the studio asks and every half minute: a vanished
 * address is closed, a new one opened. No watcher, no service.
 *
 * Every device other than this computer brings a six-digit code, minted once
 * and kept in the settings table so a phone stays signed in across restarts.
 * Digits, like a code by text message, so a phone offers its number pad. The code rides inside the link and the QR code; typing the bare
 * address leads to a page that asks for it (codePage.ts, access.ts).
 */
import { randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ownAddresses, phoneAddresses } from './addresses.js';
import { type AllowResult, allowScenri, type FirewallVerdict, firewallVerdict } from './firewall.js';

/** Digits only: a phone offers its number pad for them, as for a code by text message. */
export const CODE_ALPHABET = '0123456789';
export const CODE_LENGTH = 6;
export const CODE_SETTING = 'access.code';
/** How often the phone listeners follow the machine's addresses. */
export const SYNC_MS = 30_000;

export function newCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** What a person typed, as the code is stored: spaces and dashes do not matter. */
export const normalizeCode = (s: string): string => s.replace(/[\s-]/g, '').toUpperCase();

/** As a person reads it: two groups of three, "482 913". */
export const groupCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

/**
 * A name a person recognises for the device that just opened Scenri. iPadOS
 * Safari introduces itself as a Mac, so a Mac is named for both.
 */
export function deviceOf(ua: string | undefined): string {
  const s = ua ?? '';
  if (/iPhone/i.test(s)) return 'iPhone';
  if (/iPad/i.test(s)) return 'iPad';
  if (/Android/i.test(s)) return /Mobile/i.test(s) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/i.test(s)) return 'Mac or iPad';
  if (/Windows/i.test(s)) return 'Windows computer';
  if (/CrOS/i.test(s)) return 'Chromebook';
  if (/Linux/i.test(s)) return 'computer';
  return 'device';
}

export interface Visit {
  at: number;
  device: string;
}

export interface PhoneStatus {
  /** `this-computer`: started for this machine only (SCENRI_HOST=127.0.0.1). */
  reach: 'network' | 'this-computer';
  /** Whether the request asking is the computer running Scenri. */
  thisComputer: boolean;
  platform: string;
  /** `http://192.168.1.42:4747`, the address to type. */
  address: string | null;
  /** The address with the code in it: the QR code, the copied link. */
  url: string | null;
  code: string;
  /** Other addresses of this machine that also open Scenri. */
  others: string[];
  /** `no-network`: nothing a phone could reach; `blocked`: addresses exist but none would open. */
  problem: 'no-network' | 'blocked' | null;
  /** The last time a device other than this computer opened Scenri. */
  lastVisit: Visit | null;
}

interface Closer {
  close(): Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface PhoneAccessDeps {
  store: { getSetting(key: string): string | null; setSetting(key: string, value: string): void };
  /** SCENRI_HOST as given; unset means the default (127.0.0.1 plus phone listeners). */
  bind?: string;
  /** Fastify's request handler, read when the first phone listener opens. */
  handler?: () => Handler;
  addresses?: () => Promise<string[]>;
  own?: () => Set<string>;
  listen?: (address: string, port: number) => Promise<Closer>;
  /** Reads this computer's firewall for the studio's port. */
  firewall?: (port: number) => Promise<FirewallVerdict>;
  /** Asks the operating system to let phones in; its own prompt is the consent. */
  allow?: (port: number) => Promise<AllowResult>;
  platform?: string;
  now?: () => number;
  syncMs?: number;
}

export interface PhoneAccess {
  readonly code: string;
  /** After the studio's own listen: the real port, and the phone listeners open. */
  start(port: number): Promise<void>;
  /** Follow the machine's addresses once. Serialized; never throws. */
  sync(): Promise<void>;
  close(): Promise<void>;
  status(thisComputer: boolean): Promise<PhoneStatus>;
  /** A device other than this computer got in. */
  visit(remote: string | undefined, ua: string | undefined): void;
  firewall(): Promise<FirewallVerdict>;
  /** Allow was pressed on this computer: the OS prompt, then a fresh look. */
  allow(): Promise<{ result: AllowResult; firewall: FirewallVerdict }>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function listenWith(handler: () => Handler): (address: string, port: number) => Promise<Closer> {
  return (address, port) =>
    new Promise((resolve, reject) => {
      const server = createServer(handler());
      // the same keep-alive Fastify gives its own listener
      server.keepAliveTimeout = 72_000;
      server.once('error', reject);
      server.listen({ port, host: address, exclusive: true }, () => {
        server.off('error', reject);
        // a listener whose address vanished is closed by the next sync, never a crash
        server.on('error', () => undefined);
        resolve({
          close: () =>
            new Promise<void>((done) => {
              server.close(() => done());
              server.closeAllConnections();
            }),
        });
      });
    });
}

export function createPhoneAccess(deps: PhoneAccessDeps): PhoneAccess {
  const { store } = deps;
  const bind = (deps.bind ?? '').trim();
  const mode: 'listeners' | 'none' | 'wildcard' | 'fixed' = !bind
    ? 'listeners'
    : LOOPBACK_HOSTS.has(bind)
      ? 'none'
      : bind === '0.0.0.0' || bind === '::'
        ? 'wildcard'
        : 'fixed';
  const addresses = deps.addresses ?? phoneAddresses;
  const own = deps.own ?? ownAddresses;
  const now = deps.now ?? Date.now;
  const listen = deps.listen ?? listenWith(deps.handler ?? (() => () => undefined));
  const firewall = deps.firewall ?? ((p: number) => firewallVerdict({ port: p }));
  const allowThrough = deps.allow ?? ((p: number) => allowScenri({ port: p }));

  let code = store.getSetting(CODE_SETTING);
  // anything that is not six digits (an older six-letter code, say) is replaced
  if (!code || !new RegExp(`^\\d{${CODE_LENGTH}}$`).test(normalizeCode(code))) {
    code = newCode();
    store.setSetting(CODE_SETTING, code);
  }
  const theCode = normalizeCode(code);

  let port: number | null = null;
  const open = new Map<string, Closer>();
  /** The addresses a phone could use at the last sync, best first. */
  let candidates: string[] = [];
  let chain: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let lastVisit: Visit | null = null;
  let verdict: { at: number; value: FirewallVerdict } | null = null;

  const syncOnce = async (): Promise<void> => {
    if (closed) return;
    candidates = mode === 'none' ? [] : mode === 'fixed' ? [bind] : await addresses().catch(() => []);
    if (mode !== 'listeners' || port === null) return;
    const want = new Set(candidates);
    for (const [address, closer] of open) {
      if (want.has(address)) continue;
      open.delete(address);
      await closer.close().catch(() => undefined);
    }
    for (const address of candidates) {
      if (open.has(address) || closed) continue;
      try {
        open.set(address, await listen(address, port));
      } catch {
        // taken or gone between the read and the bind: the next sync tries again
      }
    }
  };

  const sync = (): Promise<void> => {
    chain = chain.then(syncOnce, syncOnce);
    return chain;
  };

  /** The firewall's answer, held twenty seconds: the studio asks on every QR code. */
  const readFirewall = async (): Promise<FirewallVerdict> => {
    if (port === null) return 'unknown';
    if (verdict && now() - verdict.at < 20_000) return verdict.value;
    const value = await firewall(port).catch((): FirewallVerdict => 'unknown');
    verdict = { at: now(), value };
    return value;
  };

  /** What a phone can open right now, best first. */
  const reachable = (): string[] => (mode === 'listeners' ? candidates.filter((a) => open.has(a)) : candidates);

  return {
    code: theCode,
    async start(p) {
      port = p;
      await sync();
      if (mode === 'listeners' && !closed) {
        timer = setInterval(() => void sync(), deps.syncMs ?? SYNC_MS);
        timer.unref();
      }
    },
    sync,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      await chain.catch(() => undefined);
      const all = [...open.values()];
      open.clear();
      await Promise.all(all.map((c) => c.close().catch(() => undefined)));
    },
    async status(thisComputer) {
      await sync();
      const origins = port === null ? [] : reachable().map((a) => `http://${a.includes(':') ? `[${a}]` : a}:${port}`);
      const address = origins[0] ?? null;
      return {
        reach: mode === 'none' ? 'this-computer' : 'network',
        thisComputer,
        platform: deps.platform ?? process.platform,
        address,
        url: address ? `${address}/?t=${theCode}` : null,
        code: theCode,
        others: origins.slice(1),
        problem:
          mode === 'none' || port === null
            ? null
            : candidates.length === 0
              ? 'no-network'
              : origins.length === 0
                ? 'blocked'
                : null,
        lastVisit,
      };
    },
    visit(remote, ua) {
      const at = now();
      // a phone loads dozens of files at once; one note per second is plenty
      if (lastVisit && at - lastVisit.at < 1000) return;
      // this computer opening its own link is not a phone arriving
      if (remote && own().has(remote.replace(/^::ffff:/, ''))) return;
      lastVisit = { at, device: deviceOf(ua) };
    },
    firewall: readFirewall,
    async allow() {
      if (port === null) return { result: 'unsupported', firewall: 'unknown' };
      const result = await allowThrough(port).catch((): AllowResult => 'failed');
      verdict = null;
      if (result === 'done' && mode === 'listeners') {
        // A firewall judges a socket when it starts listening, so open the
        // phone listeners afresh rather than wait for the next restart.
        chain = chain.then(async () => {
          const all = [...open.values()];
          open.clear();
          await Promise.all(all.map((c) => c.close().catch(() => undefined)));
        });
        await sync();
      }
      return { result, firewall: await readFirewall() };
    },
  };
}
