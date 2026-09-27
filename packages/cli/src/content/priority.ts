import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type DemoProduct, primaryAngleFor } from '../demoProducts.js';
import { type Scene, slotOfView } from '../scenes.js';
import type { ShowcaseEntry } from '../showcase.js';

/**
 * The order the library is fetched in: what Home shows, as Home shows it.
 * Read from the same records Home is built from, never a list of file names:
 * each wall tile in its curated order, its picture unless the package already
 * carries it, then the product chip and the presenter pill on it; after the
 * wall, the pictures the library pages open on (a presenter's portrait, a
 * scene's cover). Everything else follows in archive order (ranged.ts).
 */
export function homeFirst(o: {
  templatesRoot: string;
  showcase: readonly ShowcaseEntry[];
  demoProducts: readonly DemoProduct[];
  presenters: readonly { id: string }[];
  scenes: readonly Scene[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (rel: string) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    // a picture the package carries is served from there, whatever arrives
    if (!existsSync(join(o.templatesRoot, ...rel.split('/')))) out.push(rel);
  };
  const products = new Map(o.demoProducts.map((p) => [p.id, p]));
  for (const tile of o.showcase) {
    add(`previews/showcase/${tile.id}.jpg`);
    for (const t of tile.brief.tokens) {
      if (t.t === 'product') {
        const p = products.get(t.id);
        if (p) add(`previews/demo-products/${p.id}/${primaryAngleFor(p.category)}.jpg`);
      } else if (t.t === 'character') {
        add(`previews/presenters/${t.id}/avatar.jpg`);
      }
    }
  }
  for (const p of o.presenters) add(`previews/presenters/${p.id}/portrait.jpg`);
  for (const s of o.scenes) {
    const slot = slotOfView(s.cover ?? 'place');
    if (slot) add(`previews/${s.id}/${slot}.jpg`);
  }
  return out;
}
