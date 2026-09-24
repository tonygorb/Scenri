/**
 * What a host name or an address means, in one place: the access gate, the
 * phone listeners, the start banner and serve's own bind all ask the same
 * questions of SCENRI_HOST and of every request, and four lists of their own
 * would drift apart.
 */

/**
 * Names that unambiguously mean "the machine running this server".
 *
 * `0.0.0.0` is deliberately absent even though a server may bind to it:
 * browsers will happily load `http://0.0.0.0:4747`, which is a way to reach a
 * local server through an address the user never recognises as their own.
 */
export const LOOPBACK_NAMES: readonly string[] = ['localhost', '127.0.0.1', '::1'];

export const isLoopbackName = (host: string): boolean => LOOPBACK_NAMES.includes(host);

/** A bind to every interface at once. */
export const isWildcardHost = (host: string): boolean => host === '0.0.0.0' || host === '::';

/** A socket's far end on this machine's own loopback, IPv4-mapped included. */
export const isLoopbackAddress = (addr: string | undefined): boolean =>
  !!addr && (addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.'));

/**
 * An IPv4 address as a Host is never DNS rebinding: rebinding needs a name the
 * attacker controls, and a page whose origin is an address is already that
 * address. So every address this machine has, today's Wi-Fi or tomorrow's,
 * passes without a list that goes stale when the network changes.
 */
export function isIPv4Literal(host: string): boolean {
  const parts = host.split('.');
  return !isWildcardHost(host) && parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}
