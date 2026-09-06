import { req } from './apiReq.js';
import type { Brand } from './apiTypes.js';

export async function uploadAsset(brandId: string, kind: 'products', file: File, name: string): Promise<Brand> {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('file', file);
  const res = await fetch(`/api/brands/${brandId}/${kind}`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json();
}
export const uploadProduct = (brandId: string, file: File, name: string) =>
  uploadAsset(brandId, 'products', file, name);
export const deleteAsset = (brandId: string, kind: 'products', assetId: string) =>
  req<Brand>('DELETE', `/api/brands/${brandId}/${kind}/${assetId}`);
export const deleteProduct = (brandId: string, productId: string) => deleteAsset(brandId, 'products', productId);

/** Upload a brand mark. Re-uploading the same artwork retags it rather than adding a twin. */
export async function uploadLogo(
  brandId: string,
  file: File,
  opts: { role?: string; background?: string } = {},
): Promise<Brand> {
  const fd = new FormData();
  if (opts.role) fd.append('role', opts.role);
  if (opts.background) fd.append('background', opts.background);
  fd.append('file', file);
  const res = await fetch(`/api/brands/${brandId}/logos`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json();
}

/** Where the browser fetches a `.brand` bundle from — a plain link, so no blob juggling. */
export const brandExportUrl = (brandId: string) => `/api/brands/${brandId}/export`;

/** One more reference angle onto a product that already exists (not a new product). */
export async function addProductShot(brandId: string, productId: string, file: File, angle?: string): Promise<Brand> {
  const fd = new FormData();
  if (angle) fd.append('angle', angle);
  fd.append('file', file);
  const res = await fetch(`/api/brands/${brandId}/products/${productId}/shots`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return res.json();
}

/** Put any image in the content store and get its hash back (reference uploads). */
export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/images', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error ?? `HTTP ${res.status}`);
  return (await res.json()).hash as string;
}

/**
 * A last-gasp brand save for a page that is going away.
 *
 * `beforeunload` cannot await anything: the normal request is abandoned the
 * moment the document is torn down, which is how a headline typed in the last
 * fraction of a second before a reload was lost. `keepalive` hands the request
 * to the browser to finish on its own. Nothing can be reported back, so
 * nothing tries.
 */
export function saveBrandOnUnload(brandId: string, brand: unknown): void {
  try {
    void fetch(`/api/brands/${brandId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand }),
      keepalive: true,
    });
  } catch {
    /* the page is leaving and there is no one left to tell */
  }
}

export const imgUrl = (hash: string) => `/api/images/${hash}`;
/** Renders an `asset:<hash>` brand ref as an image URL, or null. */
export const assetUrl = (ref?: string) => (ref?.startsWith('asset:') ? imgUrl(ref.slice(6)) : null);

/**
 * The store's derivatives: `tile` for a feed cell and a catalog card, `micro`
 * for the surfaces that show a picture at 64px or less (the rail, the version
 * strip, a chip, a notification row). The original stays on `imgUrl` for the
 * stage, Compare, the clipboard and export: those are the surfaces that show
 * the pixels the engine made. A tile used to fetch the same 2 MB PNG the
 * stage does, so one screen of feed was ten megabytes of decode.
 */
type ThumbSize = 'tile' | 'micro';
const THUMB_WIDTH: Record<ThumbSize, number> = { tile: 640, micro: 160 };
export const thumbUrl = (hash: string, size: ThumbSize) => `${imgUrl(hash)}/thumb?w=${THUMB_WIDTH[size]}`;
/** Renders an `asset:<hash>` brand ref at a derivative size, or null. */
export const assetThumbUrl = (ref: string | undefined, size: ThumbSize) =>
  ref?.startsWith('asset:') ? thumbUrl(ref.slice(6), size) : null;

const STORE_IMAGE = /^\/api\/images\/([a-f0-9]{32})(?:\/thumb\?w=\d+)?$/;
/**
 * The same picture at another size when the URL is one of the store's, in
 * either of its shapes; `full` is the original. Any other URL (a curated
 * catalog file, a blob) passes through unchanged, which is what lets a card
 * that only holds a URL ask for the size it needs.
 */
export function thumbOf<T extends string | null | undefined>(url: T, size: ThumbSize | 'full'): T {
  if (!url) return url;
  const m = STORE_IMAGE.exec(url);
  if (!m) return url;
  return (size === 'full' ? imgUrl(m[1]) : thumbUrl(m[1], size)) as T;
}

/** True when a brand has made nothing at all yet — any status, not just done-and-imaged. Every caller pairs this with `loaded`: check `loaded` first so a cold fetch isn't mistaken for a genuinely empty brand. */
