import type { Brand } from '../api.js';

/**
 * The duplicate check behind the setup wizard's guard. Creating a second brand
 * with an already-used name is legal — the server dedupes the slug with a -2
 * suffix — but it is almost never what a person re-running setup meant, and it
 * is exactly how the phantom "theia-2" workspace was born. The wizard warns
 * and offers the existing brand before it creates; the API itself stays
 * permissive, so a deliberate duplicate is one extra click, not impossible.
 */
export function duplicateOf(brands: Brand[], probe: { name?: string; url?: string }): Brand | null {
  const name = normalizeName(probe.name);
  const host = normalizeHost(probe.url);
  if (!name && !host) return null;
  return (
    brands.find((b) => {
      if (host && normalizeHost(b.json?.meta?.website) === host) return true;
      if (name && normalizeName(b.json?.meta?.name ?? b.slug) === name) return true;
      return false;
    }) ?? null
  );
}

const normalizeName = (v: unknown): string | null => {
  const s = String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return s || null;
};

/** `https://www.Acme.com/shop/` and `acme.com` are the same site. */
const normalizeHost = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};
