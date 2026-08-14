import JSZip from 'jszip';
import { validateBrand } from '@scenri/brand';
import type { Core } from '@scenri/core';

/**
 * Build the bundle form of a `.brand` — a ZIP holding `brand.json` plus the
 * `assets/` it references (see packages/brand-spec/SPEC.md §Container).
 *
 * Two rules make a bundle worth handing to someone else:
 *
 * 1. **No dangling refs.** Inside the app an `asset:<hash>` the store has lost
 *    is a broken thumbnail; inside a bundle it is a file the recipient will
 *    never be able to supply. Such entries are dropped from their array and
 *    counted in the README rather than exported as a promise nothing can keep.
 * 2. **Deterministic names.** Files are named from role/id/index, never from
 *    iteration over a hash map, so exporting an unchanged brand twice produces
 *    the same listing — which is what makes a `.brand` diffable in a repo.
 */

/** Every place the schema allows an assetRef, and what to name the file there. */
const slug = (v: unknown, fallback: string): string => {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || fallback;
};

const hashOf = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  return s.startsWith('asset:') ? s.slice(6) : null;
};

interface Rewriter {
  /** Resolve one ref to a bundle-relative path, or null when it cannot travel. */
  place(ref: unknown, name: string): string | null;
  files: Map<string, Buffer>;
  missing: number;
}

function rewriter(core: Core): Rewriter {
  const files = new Map<string, Buffer>();
  const byHash = new Map<string, string>();
  const state = { missing: 0 };
  return {
    files,
    get missing() {
      return state.missing;
    },
    place(ref, name) {
      // A URL is already portable in the bare form; the spec allows it, so it
      // travels untouched rather than being downloaded into the bundle.
      if (/^https?:\/\//.test(String(ref ?? ''))) return String(ref);
      const hash = hashOf(ref);
      if (!hash) return String(ref ?? '') || null;
      const already = byHash.get(hash);
      // One image can be a product shot and a mark at once. Write the bytes
      // once and let both refs point at the same path.
      if (already) return already;
      if (!core.images.has(hash)) {
        state.missing += 1;
        return null;
      }
      const path = `assets/${name}.png`;
      files.set(path, core.images.read(hash));
      byHash.set(hash, path);
      return path;
    },
  };
}

export async function buildBrandBundle(core: Core, brandId: string): Promise<{ zip: Buffer; filename: string }> {
  const row = core.store.getBrand(brandId);
  if (!row) throw new Error('brand not found');
  // The stored document, deliberately — not the compile-time view that layers
  // in catalog products and resolved presenters. A bundle must be something
  // `PUT /api/brands/:id` would accept back.
  const json: any = structuredClone(row.json);
  const rw = rewriter(core);

  const logos: any[] = Array.isArray(json.logos) ? json.logos : [];
  json.logos = logos
    .map((logo, i) => {
      const file = rw.place(logo?.file, `logo-${slug(logo?.role, 'mark')}-${i + 1}`);
      return file ? { ...logo, file } : null;
    })
    .filter(Boolean);
  if (!json.logos.length) delete json.logos;

  const withShots = (key: 'products' | 'characters', dir: string) => {
    const rows: any[] = Array.isArray(json[key]) ? json[key] : [];
    if (!rows.length) return;
    json[key] = rows.map((r, ri) => {
      const shots: any[] = Array.isArray(r?.shots) ? r.shots : [];
      const kept = shots
        .map((shot, si) => {
          const name = `${dir}/${slug(r?.id, String(ri + 1))}-${slug(shot?.angle, String(si + 1))}`;
          const file = rw.place(shot?.file, name);
          return file ? { ...shot, file } : null;
        })
        .filter(Boolean);
      return kept.length ? { ...r, shots: kept } : omit(r, 'shots');
    });
  };
  withShots('products', 'products');
  withShots('characters', 'characters');

  // A person built here also travels with the photographs they were built from
  // and their card crop, so the bundle carries the evidence and not only the
  // views generated from it.
  const characters: any[] = Array.isArray(json.characters) ? json.characters : [];
  if (characters.length) {
    json.characters = characters.map((c, ci) => {
      const id = slug(c?.id, String(ci + 1));
      const next: any = { ...c };
      const sources: any[] = Array.isArray(c?.sourceRefs) ? c.sourceRefs : [];
      const keptSources = sources
        .map((r, si) => {
          const file = rw.place(r?.file, `characters/${id}-source-${String(si + 1).padStart(2, '0')}`);
          return file ? { ...r, file } : null;
        })
        .filter(Boolean);
      if (keptSources.length) next.sourceRefs = keptSources;
      else delete next.sourceRefs;
      const preview = rw.place(c?.preview, `characters/${id}-card`);
      if (preview) next.preview = preview;
      else delete next.preview;
      const avatar = rw.place(c?.avatar, `characters/${id}-avatar`);
      if (avatar) next.avatar = avatar;
      else delete next.avatar;
      return next;
    });
  }

  const brandScenes: any[] = Array.isArray(json.scenes) ? json.scenes : [];
  if (brandScenes.length) {
    json.scenes = brandScenes.map((s, si) => {
      const id = slug(s?.id, String(si + 1));
      const next: any = { ...s };
      const refs: any[] = Array.isArray(s?.refs) ? s.refs : [];
      const kept = refs
        .map((r, ri) => {
          const file = rw.place(r?.file, `scenes/${id}-ref-${String(ri + 1).padStart(2, '0')}`);
          return file ? { ...r, file } : null;
        })
        .filter(Boolean);
      if (kept.length) next.refs = kept;
      else delete next.refs;
      const preview = rw.place(s?.preview, `scenes/${id}-preview`);
      if (preview) next.preview = preview;
      else delete next.preview;
      return next;
    });
  }

  const refs: any[] = Array.isArray(json.imagery?.styleReferences) ? json.imagery.styleReferences : [];
  if (refs.length) {
    const kept = refs
      .map((r, i) => {
        const file = rw.place(r?.file, `imagery/ref-${String(i + 1).padStart(2, '0')}`);
        return file ? { ...r, file } : null;
      })
      .filter(Boolean);
    if (kept.length) json.imagery = { ...json.imagery, styleReferences: kept };
    else json.imagery = omit(json.imagery, 'styleReferences');
  }

  json.meta = { ...(json.meta ?? {}), updatedAt: new Date().toISOString() };

  // An export that is not a valid .brand is worse than no export: it fails at
  // the far end, in someone else's tool, with no way back to this machine.
  const v = validateBrand(json);
  if (!v.valid) throw new Error(`export would not be a valid .brand: ${v.errors.join('; ')}`);

  const zip = new JSZip();
  zip.file('brand.json', `${JSON.stringify(json, null, 2)}\n`);
  for (const path of [...rw.files.keys()].sort()) zip.file(path, rw.files.get(path) as Buffer);
  zip.file('README.txt', readme(json, rw.missing));

  return {
    zip: await zip.generateAsync({ type: 'nodebuffer' }),
    filename: `${slug(row.slug || json.meta?.name, 'brand')}.brand`,
  };
}

function omit<T extends object>(obj: T, key: string): T {
  const next: any = { ...obj };
  delete next[key];
  return next;
}

function readme(json: any, missing: number): string {
  return [
    `${json.meta?.name ?? 'Brand'} — .brand bundle`,
    '',
    'brand.json holds the whole kit; assets/ holds every image it references,',
    'and the file fields inside brand.json are paths relative to brand.json.',
    'Format: https://scenri.dev/schema/brand-0.1.schema.json',
    '',
    'Products imported from a store catalog are not included: this bundle is the',
    'brand document as stored, and catalog products are resolved at generation',
    'time from their own source.',
    missing ? `\n${missing} referenced image${missing === 1 ? ' was' : 's were'} missing and left out.` : '',
  ].join('\n');
}
