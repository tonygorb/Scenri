import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A presenter is a curated, identity-locked person: a name, a fixed
 * appearance, and a 6-shot reference set. Presenters live in the global
 * catalog (this file); a brand adopts one into its own `characters[]` roster
 * to actually use them in a brief — see server.ts's cast-to-roster route.
 */
export type PresenterPresentation = 'woman' | 'man';

export interface Presenter {
  id: string;
  name: string;
  presentation: PresenterPresentation;
  /** The casting-sheet caption, e.g. "Warm editorial · dark waves · confident, understated". */
  descriptor: string;
  ageRange: string;
  facial: string;
  skin: string;
  hair: string;
  build: string;
  wardrobeDefault: string;
  /** Industry filters, mirrors Look's `verticals`. */
  suitableCategories: string[];
  /** Style/mood tags, mirrors Look's `collections`. */
  suitableStyles: string[];
  identityNotes: string;
  negativeConstraints: string[];
  width: number;
  height: number;
}

const PRESENTATIONS = new Set<PresenterPresentation>(['woman', 'man']);
const ID = /^[a-z0-9-]+$/;

function isPresenter(x: any): x is Presenter {
  return (
    x &&
    typeof x.id === 'string' &&
    ID.test(x.id) &&
    typeof x.name === 'string' &&
    PRESENTATIONS.has(x.presentation) &&
    typeof x.descriptor === 'string' &&
    typeof x.ageRange === 'string' &&
    typeof x.facial === 'string' &&
    typeof x.skin === 'string' &&
    typeof x.hair === 'string' &&
    typeof x.build === 'string' &&
    typeof x.wardrobeDefault === 'string' &&
    Array.isArray(x.suitableCategories) &&
    x.suitableCategories.every((c: any) => typeof c === 'string' && c) &&
    Array.isArray(x.suitableStyles) &&
    x.suitableStyles.every((s: any) => typeof s === 'string' && s) &&
    typeof x.identityNotes === 'string' &&
    Array.isArray(x.negativeConstraints) &&
    x.negativeConstraints.every((n: any) => typeof n === 'string' && n) &&
    Number.isFinite(x.width) &&
    Number.isFinite(x.height)
  );
}

/** Load presenter files; a bad file is skipped with a warning, never fatal. */
export function loadPresenters(dir = defaultPresentersDir()): { presenters: Presenter[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!dir || !existsSync(dir)) return { presenters: [], warnings: [`presenters dir not found: ${dir}`] };
  const presenters: Presenter[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (isPresenter(parsed)) presenters.push(parsed);
      else warnings.push(`invalid presenter skipped: ${f}`);
    } catch {
      warnings.push(`unparseable presenter skipped: ${f}`);
    }
  }
  return { presenters, warnings };
}

export function presenterResolver(presenters: Presenter[]): (id: string) => Presenter | undefined {
  const byId = new Map<string, Presenter>();
  for (const p of presenters) byId.set(p.id, p);
  return (id: string) => byId.get(id);
}

/** Every category and style actually in use, for the library filters. */
export function presenterFacetsOf(presenters: Presenter[]): { categories: string[]; styles: string[] } {
  const categories = new Set<string>();
  const styles = new Set<string>();
  for (const p of presenters) {
    for (const c of p.suitableCategories) categories.add(c);
    for (const s of p.suitableStyles) styles.add(s);
  }
  return { categories: [...categories].sort(), styles: [...styles].sort() };
}

export function defaultPresentersDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: monorepo root /templates/presenters; published: bundled next to package
  for (const p of [
    join(here, '..', '..', '..', 'templates', 'presenters'),
    join(here, '..', 'templates', 'presenters'),
  ]) {
    if (existsSync(p)) return p;
  }
  return join(here, '..', '..', '..', 'templates', 'presenters');
}
