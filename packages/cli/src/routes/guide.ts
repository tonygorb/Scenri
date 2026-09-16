import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';

/**
 * First-use guidance: the welcome, the page tours and the refine row, each said
 * once to someone new (DESIGN.md, "First use"). The record is the install's, not a
 * browser's, so a phone reaching the studio over the network and a second
 * origin on the same machine agree about what has already been said.
 *
 * Who counts as new is decided once, at the first boot of a build that has
 * this record: a home with no brand then is someone who has never used
 * Scenri, and a home with brands is someone upgrading, who is never taught.
 * Nothing after that boot changes it, so deleting every brand does not make
 * an old hand new again, and learning something is never derived from what
 * the library holds.
 */
export const GUIDE_CONCEPTS = [
  'welcome',
  'tour-home',
  'tour-create',
  'tour-products',
  'tour-presenters',
  'tour-scenes',
  'tour-skip',
  'tours-off',
  'refine',
] as const;
export type GuideConcept = (typeof GUIDE_CONCEPTS)[number];
export interface GuideState {
  eligible: boolean;
  learned: GuideConcept[];
}

type Store = Core['store'];
const KEY = 'guide';

function parse(raw: string | null): (GuideState & { v: 1 }) | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<GuideState> & { v?: unknown };
    if (j.v !== 1 || typeof j.eligible !== 'boolean' || !Array.isArray(j.learned)) return null;
    const learned = j.learned.filter((c): c is GuideConcept => (GUIDE_CONCEPTS as readonly string[]).includes(c));
    return { v: 1, eligible: j.eligible, learned };
  } catch {
    return null;
  }
}

function write(store: Store, state: GuideState): void {
  store.setSetting(KEY, JSON.stringify({ v: 1, eligible: state.eligible, learned: state.learned }));
}

/** The boot decision. Idempotent: only a home with no record at all is judged. */
export function stampGuide(store: Store): void {
  if (store.getSetting(KEY) !== null) return;
  write(store, { eligible: store.listBrands().length === 0, learned: [] });
}

/** A record that cannot be read teaches nobody: silence is the safe failure. */
export function readGuide(store: Store, env: NodeJS.ProcessEnv): GuideState {
  const g = parse(store.getSetting(KEY));
  return {
    eligible: env.SCENRI_NO_GUIDE !== '1' && (g?.eligible ?? false),
    learned: g?.learned ?? [],
  };
}

export function learnGuide(store: Store, concept: GuideConcept): void {
  const g = parse(store.getSetting(KEY)) ?? { v: 1 as const, eligible: false, learned: [] };
  if (g.learned.includes(concept)) return;
  write(store, { eligible: g.eligible, learned: [...g.learned, concept] });
}

export function registerGuideRoutes(app: FastifyInstance, deps: { core: Core; env?: NodeJS.ProcessEnv }): void {
  const { core } = deps;
  const env = deps.env ?? process.env;
  stampGuide(core.store);

  app.get('/api/guide', async () => readGuide(core.store, env));

  app.post('/api/guide/learned', async (req, reply) => {
    const concept = (req.body as { concept?: unknown } | undefined)?.concept;
    if (typeof concept !== 'string' || !(GUIDE_CONCEPTS as readonly string[]).includes(concept)) {
      return reply.status(400).send({ error: 'unknown concept' });
    }
    learnGuide(core.store, concept as GuideConcept);
    return readGuide(core.store, env);
  });
}
