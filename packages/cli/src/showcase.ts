import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BriefToken } from './brief.js';

/**
 * A showcase entry is a curated example: a real generated shot's exact
 * recipe (the same `brief.tokens` shape a `TreeNode` stores), so opening one
 * from the homepage gallery reproduces the identical chips — product,
 * presenter, scene, art direction — that made the image, ready to remix.
 */
export interface ShowcaseEntry {
  id: string;
  title: string;
  /** Lowercase key from apps/studio/src/productCategories.ts's PRODUCT_CATEGORIES. */
  category: string;
  brief: { tokens: BriefToken[]; templateFields?: Record<string, string> };
  width: number;
  height: number;
}

const ID = /^[a-z0-9-]+$/;
const TOKEN_KINDS = new Set(['text', 'product', 'character', 'color', 'ref', 'template', 'format']);

function isShowcaseEntry(x: any): x is ShowcaseEntry {
  return (
    x &&
    typeof x.id === 'string' &&
    ID.test(x.id) &&
    typeof x.title === 'string' &&
    typeof x.category === 'string' &&
    x.category &&
    x.brief &&
    Array.isArray(x.brief.tokens) &&
    x.brief.tokens.every((t: any) => t && typeof t.t === 'string' && TOKEN_KINDS.has(t.t)) &&
    Number.isFinite(x.width) &&
    Number.isFinite(x.height)
  );
}

/** Load showcase files; a bad file is skipped with a warning, never fatal. */
export function loadShowcase(dir = defaultShowcaseDir()): { showcase: ShowcaseEntry[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!dir || !existsSync(dir)) return { showcase: [], warnings: [`showcase dir not found: ${dir}`] };
  const showcase: ShowcaseEntry[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (isShowcaseEntry(parsed)) showcase.push(parsed);
      else warnings.push(`invalid showcase entry skipped: ${f}`);
    } catch {
      warnings.push(`unparseable showcase entry skipped: ${f}`);
    }
  }
  return { showcase, warnings };
}

/** Every category actually in use, for the gallery tabs. */
export function showcaseFacetsOf(showcase: ShowcaseEntry[]): { categories: string[] } {
  const categories = new Set<string>();
  for (const s of showcase) categories.add(s.category);
  return { categories: [...categories].sort() };
}

export function defaultShowcaseDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: monorepo root /templates/showcase; published: bundled next to package
  for (const p of [join(here, '..', '..', '..', 'templates', 'showcase'), join(here, '..', 'templates', 'showcase')]) {
    if (existsSync(p)) return p;
  }
  return join(here, '..', '..', '..', 'templates', 'showcase');
}
