import { assetUrl, type Presenter } from './api.js';

/**
 * The one answer to "what goes in a presenter's avatar box".
 *
 * Every small square or circle that shows a person — the brief chip, the
 * attach panel, the picker, the caret menu, the shot's ingredient row — used
 * to pick its own image and its own fallback, and three different chains grew:
 * one used the raw full-length studio shot inside a 15px circle, one skipped
 * the avatar entirely, and the `crop` hint that fixes the framing was honoured
 * by exactly one of four consumers. This module is the chain, once.
 *
 * `src` is the best available image: the purpose-built square head crop when
 * one exists, else the 4:5 card, else the first shot or source photo. `crop`
 * is set whenever `src` is NOT a real avatar — the consumer must then pull the
 * framing toward the top of the picture (the face) instead of centring it and
 * rendering a torso. The CSS half of the contract is `img[data-crop='top']`
 * in each surface's own stylesheet.
 */
export interface PresenterVisual {
  src: string | null;
  crop?: 'top';
}

/** For anything already shaped like a `Presenter` (catalog or adapted custom). */
export function presenterAvatar(
  p: Pick<Presenter, 'avatarUrl' | 'previewUrl'> & { shots?: string[] },
): PresenterVisual {
  if (p.avatarUrl) return { src: p.avatarUrl };
  const src = p.previewUrl ?? p.shots?.[0] ?? null;
  return src ? { src, crop: 'top' } : { src: null };
}

/** For a raw `brand.json.characters[]` roster row, whose fields are asset refs. */
export function characterAvatar(c: {
  avatar?: string;
  preview?: string;
  shots?: { file?: string }[];
  sourceRefs?: { file?: string }[];
}): PresenterVisual {
  const avatar = assetUrl(c.avatar);
  if (avatar) return { src: avatar };
  const first = (rows?: { file?: string }[]): string | null => (Array.isArray(rows) ? assetUrl(rows[0]?.file) : null);
  const src = assetUrl(c.preview) ?? first(c.shots) ?? first(c.sourceRefs);
  return src ? { src, crop: 'top' } : { src: null };
}
