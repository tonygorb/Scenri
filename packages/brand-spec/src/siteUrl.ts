// SPDX-License-Identifier: Apache-2.0
/**
 * Turning what a person pasted into a URL, in one place.
 *
 * The rule used to live in three half-right copies. The one in the studio read
 * the raw field rather than its trimmed value, so a leading space made
 * `https://` + ` https://acme.com`, and Node's parser threw a bare
 * `TypeError: Invalid URL` that the server handed straight to the screen. A
 * tester read that under their own perfectly good website and concluded Scenri
 * had rejected it for not being a shop.
 *
 * So: one function, server-owned, and a sentence for every way it can say no.
 * Nothing here reaches the network; refusing a private address is
 * safeFetch's job, because an e2e fixture has to be able to serve from
 * 127.0.0.1 while a user's paste must not.
 */

export type SiteUrlReason = 'empty' | 'scheme' | 'space' | 'host' | 'unparseable';

export type SiteUrl =
  | { ok: true; url: string; host: string; addedScheme: boolean }
  | { ok: false; reason: SiteUrlReason; message: string; suggestion?: string };

/**
 * Characters that carry no width and no meaning here. They ride in on a paste
 * from a document or a chat app, and a zero-width space inside a hostname is
 * invisible in the field and fatal to the parser.
 */
const INVISIBLE = /[​-‍⁠﻿­᠎‎‏‪-‮⁦-⁩]/g;
/** Every other Unicode space, mapped to a plain one so trimming can see it. */
const SPACES = /[\t\n\r\f\v   -   　]/g;
/**
 * A scheme is only a scheme with its slashes. `acme.com:8080` satisfies
 * RFC 3986's scheme syntax, and `new URL` reads its protocol as `acme.com:`,
 * so a looser test turns a host with a port into nonsense.
 */
const SCHEMED = /^[a-z][a-z0-9+.-]*:\/\//i;
/** The schemes that carry no authority, so the slashes rule cannot catch them. */
const OPAQUE = /^(javascript|data|mailto|tel|sms|file|about|blob|chrome|chrome-extension|view-source):/i;
const HTTPISH = /^https?:\/\//i;
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

const EXAMPLE = 'acme.com';

const MESSAGES: Record<SiteUrlReason, string> = {
  empty: `Paste a website address, like ${EXAMPLE}.`,
  scheme: `Scenri reads web addresses only, the ones that start with http or https. Try ${EXAMPLE}.`,
  space: 'A web address cannot contain a space.',
  host: `That does not look like a website address. Try ${EXAMPLE}.`,
  unparseable: `That does not look like a website address. Try ${EXAMPLE}.`,
};

const no = (reason: SiteUrlReason, suggestion?: string): SiteUrl => ({
  ok: false,
  reason,
  message: suggestion && reason === 'space' ? `${MESSAGES.space} Did you mean ${suggestion}?` : MESSAGES[reason],
  ...(suggestion ? { suggestion } : {}),
});

/**
 * Strip one layer of the wrapping a mail client or chat app adds.
 *
 * The curly pairs are here because that is what a paste from a document or a
 * chat app actually carries: an editor turns `"acme.com"` into `“acme.com”`
 * before anyone copies it, and the straight-quote rule below never sees them.
 */
function unwrap(value: string): string {
  const pairs: [string, string][] = [
    ['<', '>'],
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['«', '»'],
  ];
  for (const [open, close] of pairs) {
    if (value.length >= 2 && value.startsWith(open) && value.endsWith(close)) return value.slice(1, -1).trim();
  }
  return value;
}

export function normalizeSiteUrl(input: unknown): SiteUrl {
  const cleaned = unwrap(
    String(input ?? '')
      .replace(INVISIBLE, '')
      .replace(SPACES, ' ')
      .trim(),
  );
  if (cleaned === '') return no('empty');

  const addedScheme = !SCHEMED.test(cleaned) && !OPAQUE.test(cleaned);
  if (!addedScheme && !HTTPISH.test(cleaned)) return no('scheme');
  const candidate = addedScheme ? `https://${cleaned}` : cleaned;

  // A space left in the authority is a typo or two things pasted as one, and
  // guessing which would be worse than asking.
  const authority = candidate.slice(candidate.indexOf('://') + 3).split(/[/?#]/)[0];
  if (authority.includes(' ')) {
    const squeezed = normalizeSiteUrl(cleaned.replace(/ /g, ''));
    return no('space', squeezed.ok ? squeezed.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : undefined);
  }

  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return no('unparseable');
  }
  // Credentials survive toString(), and a brand's website is not a place to
  // keep someone's password.
  u.username = '';
  u.password = '';
  u.hash = '';
  const host = u.hostname.replace(/\.$/, '');
  u.hostname = host;
  if (!host.includes('.') && !IP_LITERAL.test(host) && host !== 'localhost') return no('host');

  return { ok: true, url: u.toString(), host, addedScheme };
}
