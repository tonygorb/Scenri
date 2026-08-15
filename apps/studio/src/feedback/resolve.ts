import { areaChain } from './registry.js';
import type { Rect, TargetIdentity } from './types.js';
import { clip } from './scrub.js';

/**
 * Turn the node a tester clicked into something a report can name.
 *
 * Three sources, because each answers a different question. The `sc-` class
 * chain says what kind of thing it is. `data-fb-*` says *which* one — a class
 * cannot tell two shot tiles apart, and that identity is the whole reason a
 * report about a generated image can carry its shot id. The accessible name
 * and text say what the tester was looking at.
 */

const IMAGE_SRC = /\/api\/images\/([a-f0-9]{32})/;

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};

/** `aria-label`, then the attributes that stand in for one, then the text. */
function accessibleName(el: Element): string | null {
  const attr =
    el.getAttribute('aria-label') ??
    el.getAttribute('title') ??
    el.getAttribute('alt') ??
    el.getAttribute('placeholder');
  if (attr?.trim()) return clip(attr.trim(), 120);
  const labelled = el.getAttribute('aria-labelledby');
  if (labelled) {
    const t = labelled
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    if (t) return clip(t, 120);
  }
  return null;
}

/** Nearest ancestor (inclusive) carrying `attr`, and that attribute's value. */
function climb(el: Element, attr: string): string | null {
  const hit = el.closest(`[${attr}]`);
  return hit?.getAttribute(attr) ?? null;
}

export function resolveTarget(el: Element): TargetIdentity {
  const variantRaw = climb(el, 'data-fb-variant');
  const variant = variantRaw === null ? null : Number.parseInt(variantRaw, 10);

  // An <img> is usually the point of a report about a generated shot, so look
  // at the target and at the image it sits on top of.
  const img = el.matches('img')
    ? el
    : (el.querySelector('img') ?? el.closest('figure,button,div')?.querySelector('img'));
  const imageHash = img?.getAttribute('src')?.match(IMAGE_SRC)?.[1] ?? null;

  const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  return {
    area: areaChain(el)[0] ?? null,
    areaChain: areaChain(el),
    fb: climb(el, 'data-fb'),
    fbId: climb(el, 'data-fb-id'),
    nodeId: climb(el, 'data-fb-node'),
    variant: Number.isFinite(variant) ? variant : null,
    imageHash,
    role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
    accessibleName: accessibleName(el),
    text: text ? clip(text, 120) : null,
    tag: el.tagName.toLowerCase(),
    rect: rectOf(el),
  };
}

/**
 * Which shot a target belongs to, and which of its images.
 *
 * `data-fb-node` covers everything the DOM contract tags. The hash lookup
 * covers everything else that renders a generated image — provenance thumbs,
 * lineage frames, ingredient chips — and those legitimately point at a
 * *different* shot than the one on screen, which is exactly the report the
 * owner wants.
 */
export function resolveNode(
  target: TargetIdentity,
  byHash: Map<string, { nodeId: string; index: number }>,
): { nodeId: string | null; variant: number | null } {
  if (target.nodeId) return { nodeId: target.nodeId, variant: target.variant ?? 0 };
  if (target.imageHash) {
    const hit = byHash.get(target.imageHash);
    if (hit) return { nodeId: hit.nodeId, variant: hit.index };
  }
  return { nodeId: null, variant: null };
}

/** hash -> which shot produced it, for the fallback above. */
export function imageIndex(nodes: { id: string; images: string[] }[]): Map<string, { nodeId: string; index: number }> {
  const m = new Map<string, { nodeId: string; index: number }>();
  for (const n of nodes) {
    n.images.forEach((h, index) => {
      m.set(h, { nodeId: n.id, index });
    });
  }
  return m;
}
