/**
 * What a start prints: where the studio is on this computer, where a phone on
 * the same Wi-Fi finds it, and where the library lives. Pure, so its copy is
 * tested like every other line a person reads (bootError.test.ts's rules).
 */
import { isLoopbackName, isWildcardHost } from './network/hosts.js';
import { groupCode } from './network/phoneAccess.js';

export interface StartInfo {
  /** The main listener's host, SCENRI_HOST or the default. */
  host: string;
  port: number;
  home: string;
  studioBuilt: boolean;
  /** The phone address and its code, when a phone could open it. An empty code is left out: see startLines. */
  phone: { address: string | null; code: string } | null;
}

/**
 * The address this computer's own browser opens. A loopback or wildcard
 * listener answers on 127.0.0.1; a listener on one named address answers only
 * there, and from there this computer is a device like any other, so the
 * link carries the code.
 */
export function localUrl(host: string, port: number, code: string): string {
  if (host === '::1') return `http://[::1]:${port}`;
  if (isLoopbackName(host) || isWildcardHost(host)) return `http://127.0.0.1:${port}`;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}/${code ? `?t=${code}` : ''}`;
}

export function startLines(info: StartInfo): string[] {
  const lines = [`Scenri Studio → ${localUrl(info.host, info.port, info.phone?.code ?? '')}`];
  // A start with no terminal (the desktop icon) writes these lines to a log
  // file, and a code in a log outlives the start; Settings shows it instead.
  const code = info.phone?.code ? groupCode(info.phone.code) : 'in Settings';
  if (info.phone?.address) lines.push(`on your phone → ${info.phone.address}  code ${code}`);
  lines.push(`data dir      → ${info.home}`, 'Keep this window open while Scenri is running.');
  if (!info.studioBuilt) lines.push('', '(studio UI not built, API only. Run: pnpm build)');
  return lines;
}
