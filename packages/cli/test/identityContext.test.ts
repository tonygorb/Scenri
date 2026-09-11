import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planStep, type PresenterDraftRecord } from '../src/presenterDrafts.js';
import { PRESENTER_VIEWS, type KeepItem, type PresenterView } from '../src/presenterPrompts.js';

/**
 * Every combination, not the one that was reported.
 *
 * Some people have a prosthetic and some do not; some wear glasses and some
 * do not. The combinations that break are never the ones anybody thought to
 * test, and there are only a hundred and twenty eight of them, so all of them
 * are tested. A compile is a pure call and costs microseconds, which is why
 * this can be exhaustive where the image battery can only ever be a sample.
 *
 * The words come from the studio's own trait table rather than from a copy of
 * it: a fixture that drifts from the table proves nothing about the table.
 * Same source-reading contract as `searchParity.test.ts` and
 * `presenterViewParity.test.ts`, including the guard that the extraction
 * itself found something.
 */
const TABLE = readFileSync(
  join(__dirname, '..', '..', '..', 'apps', 'studio', 'src', 'create', 'presenter', 'presenterTraits.ts'),
  'utf8',
);

/** The longest option each trait can produce, which is the worst case for any cap. */
function worstOf(trait: string): string {
  const block = TABLE.split(`id: '${trait}',`)[1] ?? '';
  const upTo = block.split('saying:')[0];
  const words = [...upTo.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]);
  expect(words.length).toBeGreaterThan(2);
  return words.sort((a, b) => b.length - a.length)[0];
}

/** Where it is, for the two traits whose answer is incomplete without a side. */
function sideOf(trait: string, side: 'left' | 'right'): string {
  const block = TABLE.split(`id: '${trait}',`)[1] ?? '';
  const where = block.split('where: {')[1]?.split('],')[0] ?? '';
  const found = [...where.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]).find((w) => w.includes(side));
  expect(found, `${trait} has a ${side} placement`).toBeTruthy();
  return found as string;
}

const TRAIT_IDS = ['glasses', 'freckles', 'makeup', 'scar', 'piercing', 'tattoo', 'prosthetic'] as const;

/** One answered trait, exactly as the studio compiles it. */
function itemOf(trait: string, side: 'left' | 'right' = 'left'): KeepItem {
  const words = worstOf(trait);
  const placed = trait === 'tattoo' || trait === 'prosthetic' ? `${words} ${sideOf(trait, side)}` : words;
  return { id: trait, words: placed };
}

const EMPTY = { status: 'empty' as const, attempts: 0, rejected: [] };
const APPROVED = (hash: string) => ({ ...EMPTY, status: 'approved' as const, hash });

function draftOf(items: KeepItem[], over: Partial<PresenterDraftRecord> = {}): PresenterDraftRecord {
  return {
    source: 'synthetic',
    direction: 'a woman in her 30s, a solid build',
    name: 'Noa',
    analysis: { promptName: 'a woman in her 30s' },
    sources: [],
    keepItems: items,
    views: {
      portrait: APPROVED('p'),
      front: APPROVED('f'),
      'three-quarter': EMPTY,
      back: EMPTY,
      left: APPROVED('l'),
      right: EMPTY,
    },
    identityEdits: [],
    ...over,
  } as unknown as PresenterDraftRecord;
}

/** Every subset of the seven traits: 128 of them, smallest first. */
function everyCombination(): (typeof TRAIT_IDS)[number][][] {
  const out: (typeof TRAIT_IDS)[number][][] = [];
  for (let mask = 0; mask < 1 << TRAIT_IDS.length; mask += 1) {
    out.push(TRAIT_IDS.filter((_, i) => mask & (1 << i)));
  }
  return out;
}

/**
 * Which views each of these details belongs in, written out rather than
 * derived, so this states an intention instead of repeating the code.
 *
 * A back view has no face, and a portrait is framed to the collarbone, so a
 * detail on a forearm can only be obeyed by reframing it and losing the face
 * every other view is drawn from. In this fixture the tattoo is placed on a
 * forearm and the prosthetic replaces an arm, which is what puts them both
 * below the crop.
 */
const CAN_SHOW: Record<string, (v: PresenterView) => boolean> = {
  glasses: (v) => v !== 'back',
  freckles: (v) => v !== 'back',
  makeup: (v) => v !== 'back',
  scar: (v) => v !== 'back',
  piercing: (v) => v !== 'back',
  tattoo: (v) => v !== 'portrait',
  prosthetic: (v) => v !== 'portrait',
};
const shows = (view: PresenterView, trait: string): boolean => CAN_SHOW[trait](view);

describe('what a person is, in every combination there is', () => {
  const combos = everyCombination();

  it('carries every detail whole, to every view that can show it, and to no other', () => {
    expect(combos).toHaveLength(128);
    for (const combo of combos) {
      const items = combo.map((t) => itemOf(t));
      for (const view of PRESENTER_VIEWS) {
        const { prompt } = planStep(draftOf(items), view, undefined, 5);
        for (const trait of combo) {
          const words = itemOf(trait).words;
          if (shows(view, trait)) {
            // whole: not a prefix of it, and not the tail of a severed clause
            expect(prompt, `${trait} in ${view} of [${combo.join('+')}]`).toContain(words);
          } else {
            expect(prompt, `${trait} kept out of ${view}`).not.toContain(words);
          }
        }
        // nothing appears that nobody asked for
        for (const trait of TRAIT_IDS.filter((t) => !combo.includes(t))) {
          expect(prompt, `${trait} was never asked for`).not.toContain(itemOf(trait).words);
        }
      }
    }
  });

  it('never loses a detail to the length of the others', () => {
    // the reported failure, generalised: joined into one capped sentence, the
    // seven together ran to 369 characters and the last one chosen was gone
    const all = TRAIT_IDS.map((t) => itemOf(t));
    expect(all.map((i) => i.words).join(', ').length).toBeGreaterThan(300);
    for (const view of PRESENTER_VIEWS) {
      const { prompt } = planStep(draftOf(all), view, undefined, 5);
      for (const item of all) {
        if (shows(view, item.id)) expect(prompt).toContain(item.words);
      }
    }
  });

  it('keeps a side on the side it was given, and says whose side it is', () => {
    for (const trait of ['tattoo', 'prosthetic'] as const) {
      for (const side of ['left', 'right'] as const) {
        const other = side === 'left' ? 'right' : 'left';
        const item = itemOf(trait, side);
        for (const view of PRESENTER_VIEWS) {
          if (!shows(view, trait)) continue;
          const { prompt } = planStep(draftOf([item]), view, undefined, 5);
          expect(prompt).toContain(item.words);
          expect(prompt).not.toContain(itemOf(trait, other).words);
          expect(prompt).toContain("their own left and right, not the viewer's");
        }
      }
    }
  });

  it('changes only what changed', () => {
    const before = [itemOf('glasses'), itemOf('prosthetic', 'left'), itemOf('tattoo', 'right')];
    const after = [itemOf('glasses'), itemOf('prosthetic', 'right'), itemOf('tattoo', 'right')];
    const a = planStep(draftOf(before), 'front', undefined, 5).prompt;
    const b = planStep(draftOf(after), 'front', undefined, 5).prompt;
    expect(a).not.toBe(b);
    // everything either side of the one item is untouched
    expect(b.replace(after[1].words, before[1].words)).toBe(a);
  });

  it('does not depend on the order the questions were answered in', () => {
    const items = TRAIT_IDS.map((t) => itemOf(t));
    const shuffled = [...items].reverse();
    for (const view of PRESENTER_VIEWS) {
      const one = planStep(draftOf(items), view, undefined, 5).prompt;
      const two = planStep(draftOf(shuffled), view, undefined, 5).prompt;
      // the same details, said in the order they were kept in
      for (const item of items) {
        if (shows(view, item.id)) {
          expect(one).toContain(item.words);
          expect(two).toContain(item.words);
        }
      }
    }
  });

  it('leaves nothing behind when a detail is removed', () => {
    const gone = itemOf('prosthetic', 'left');
    const after = planStep(draftOf([itemOf('glasses')]), 'front', undefined, 5).prompt;
    expect(after).not.toContain(gone.words);
    expect(after).not.toContain('prosthetic');
  });

  it('boards the picture of a detail, or says why it could not', () => {
    const withRef = { ...itemOf('prosthetic', 'left'), refs: ['a'.repeat(32)] };
    // room to spare: it rides, named, with its own role
    const roomy = planStep(draftOf([withRef]), 'front', undefined, 5);
    expect(roomy.refs).toContain('a'.repeat(32));
    expect(roomy.roles.at(-1)).toBe('detail');
    expect(roomy.prompt).toContain('The attached detail pictures show, in this order:');
    expect(roomy.dropped).toEqual([]);
    // a view that cannot show it does not carry it, and says so
    const portrait = planStep(draftOf([withRef]), 'portrait', undefined, 5);
    expect(portrait.refs).not.toContain('a'.repeat(32));
    expect(portrait.dropped.join(' ')).toContain('not shown in this view');
    // a full budget still holds one seat: the identity loses its last
    // photograph, never an approved view
    const crowded = planStep(
      draftOf([withRef], { source: 'photos', sources: ['s1', 's2', 's3', 's4'] }),
      'front',
      undefined,
      5,
    );
    expect(crowded.refs).toContain('a'.repeat(32));
    // the face is the dependency and stays; the last photograph is what pays
    expect(crowded.refs[0]).toBe('p');
    expect(crowded.refs).not.toContain('s4');
    expect(crowded.dropped.join(' ')).toContain('no room');
  });
});
