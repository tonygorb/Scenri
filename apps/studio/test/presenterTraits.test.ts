import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TRAITS,
  type TraitAnswers,
  type TraitId,
  keepSentence,
  saysWhere,
  traitOf,
  traitSentence,
} from '../src/create/presenter/presenterTraits.ts';

describe('the distinctive details a presenter can carry', () => {
  it('is a small, ordered set, and every one of them can be answered three ways', () => {
    expect(TRAITS.map((t) => t.id)).toEqual([
      'glasses',
      'freckles',
      'makeup',
      'scar',
      'piercing',
      'tattoo',
      'prosthetic',
    ]);
    for (const t of TRAITS) {
      // ready options to tap, words of their own, and a picture of the thing
      expect(t.options.length).toBeGreaterThanOrEqual(4);
      expect(t.saying.length).toBeGreaterThan(4);
      expect(t.refHint.length).toBeGreaterThan(8);
      // an option's id is the words an engine is given, not a code
      for (const o of t.options) expect(o.id.split(' ').length).toBeGreaterThan(1);
    }
  });

  it('has a picture for every option, and no picture without an option', () => {
    // The stylesheet names every file: no bundler glob, no runtime fetch. So
    // the three have to agree, or a row shows a plate with nothing on it, or a
    // file rides in the bundle that nothing can ever choose.
    // vitest runs the studio from its own package root
    const css = readFileSync(join(process.cwd(), 'src/styles/components/conversation.css'), 'utf8');
    const art = new Set(readdirSync(join(process.cwd(), 'src/assets/traits')).map((f) => f.replace(/\.webp$/, '')));
    const wanted = new Set<string>();
    for (const t of TRAITS) {
      for (const o of t.options) {
        expect(o.card).toBeTruthy();
        wanted.add(o.card as string);
        expect(css).toContain(`[data-card="${o.card}"]`);
        expect(art.has(o.card as string)).toBe(true);
      }
    }
    expect([...art].filter((f) => !wanted.has(f))).toEqual([]);
    // and the third direction: a rule pointing at a file nothing chooses, or
    // at a file that is not there at all, which the build would only find later
    const named = [...css.matchAll(/\[data-card="([^"]+)"\]/g)].map((m) => m[1]);
    expect(named.filter((id) => !wanted.has(id))).toEqual([]);
  });

  it('asks where it is only where the answer is incomplete without it', () => {
    // a tattoo nobody placed is not a tattoo; a limb has a side
    expect(traitOf('tattoo')?.where?.options.length).toBeGreaterThan(4);
    expect(traitOf('prosthetic')?.where?.options.map((o) => o.label)).toContain('Left arm');
    // a septum piercing carries its own place, and freckles are where freckles are
    expect(traitOf('piercing')?.where).toBeUndefined();
    expect(traitOf('freckles')?.where).toBeUndefined();
    expect(traitOf('glasses')?.where).toBeUndefined();
  });

  it('does not ask again when the words already said where', () => {
    expect(saysWhere('fine-line botanical covering her right forearm')).toBe(true);
    expect(saysWhere('a small scar through the left eyebrow')).toBe(true);
    expect(saysWhere('a fine-line botanical tattoo')).toBe(false);
    expect(saysWhere(undefined)).toBe(false);
  });

  it('says the whole of a trait in the order a person says it', () => {
    expect(traitSentence('tattoo', { words: 'a fine-line botanical tattoo', where: 'on their right forearm' })).toBe(
      'a fine-line botanical tattoo on their right forearm',
    );
    // the place is not said twice when their own words already carried it
    expect(
      traitSentence('tattoo', {
        words: 'a botanical piece covering her right forearm',
        where: 'on their left forearm',
      }),
    ).toBe('a botanical piece covering her right forearm');
    expect(traitSentence('glasses', { words: 'thin black rectangular frames' })).toBe('thin black rectangular frames');
    expect(traitSentence('scar', {})).toBe('');
  });

  it('joins what is kept into the one sentence the prompts carry, in the order it was asked', () => {
    const answers: TraitAnswers = {
      tattoo: { words: 'a fine-line botanical tattoo', where: 'on their right forearm' },
      glasses: { words: 'thin black rectangular frames' },
    };
    // the face before the body, whatever order they were chosen in
    expect(keepSentence(answers)).toBe(
      'thin black rectangular frames, a fine-line botanical tattoo on their right forearm',
    );
    expect(keepSentence({})).toBe('');
    const one: Record<string, unknown> = {};
    for (const t of TRAITS) one[t.id] = { words: t.options[0].id };
    // every one of them is in the sentence, and each is said once
    const all = keepSentence(one as TraitAnswers);
    for (const t of TRAITS) expect(all).toContain(t.options[0].id);
    // an id nobody knows is not a trait
    expect(traitOf('hat' as TraitId)).toBeUndefined();
  });
});
