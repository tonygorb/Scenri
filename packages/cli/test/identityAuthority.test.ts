import { describe, expect, it } from 'vitest';
import { compileBrief } from '../src/brief.js';
import { characterFactDirectives, hairDirective, mendedTrait, referenceIdentityGuard } from '../src/briefDirectives.js';

/**
 * The presenter identity pass (2026-09-24). Every rule here was measured on
 * real draws before it was written: the presenter's own traits hold only when
 * the pictures and the words both carry them, and a picture of someone else
 * lends a pose and a place, never a person or their clothes.
 */

const images: any = { has: () => true, pathFor: (h: string) => `/store/${h}.png` };
const caps = (n: number): any => ({ id: 'codex-cli', displayName: 'Codex', maxReferenceImages: n });
const dax = {
  id: 'dax',
  name: 'Dax',
  promptName: 'Dax',
  identityNotes: 'gold aviator sunglasses, a wave tattoo on the inside of his right forearm',
  hair: 'long platinum waves with darker roots',
  // Deps' real stored build: hard-sliced at 200 characters, mid-word.
  build:
    'The visible upper body has broad shoulders relative to the neck, defined collarbones and a lean, muscular upper ' +
    'chest. Height and overall leanness are supplied as tall and lean, but full-body proporti',
  shots: [
    { file: 'asset:face', angle: 'portrait' },
    { file: 'asset:body', angle: 'front' },
    { file: 'asset:turn', angle: 'three-quarter' },
  ],
};
const product = {
  id: 'p1',
  name: 'Amber Serum',
  shots: ['asset:p-a', 'asset:p-b', 'asset:p-c'].map((file) => ({ file })),
};
const brand = { name: 'Aurelia', products: [product], characters: [dax] };
const compile = (tokens: any[], seats: number, wordsFor?: (h: string) => string | null) =>
  compileBrief({ tokens }, { brand, images, engineCaps: caps(seats), wordsFor } as any);

describe('presenter identity authority', () => {
  it('a presenter keeps face and full body beside a product and a picture of someone else', () => {
    const r = compile(
      [
        { t: 'character', id: 'dax' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' posed like ' },
        { t: 'ref', imageHash: 'someone-else' },
      ],
      4,
    );
    expect(r.attachments.filter((a) => a.role === 'character').map((a) => a.angle)).toEqual(['portrait', 'front']);
    expect(r.attachments.map((a) => a.hash)).toContain('someone-else');
    expect(r.attachments.map((a) => a.hash)).toContain('p-a');
  });

  it('a refinement is allocated by the edit route, so the compile adds no floor there', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'dax' },
          { t: 'ref', imageHash: 'r1' },
        ],
      },
      { brand, images, engineCaps: caps(32), mode: 'edit' } as any,
    );
    expect(r.attachments.filter((a) => a.role === 'character')).toHaveLength(3);
  });

  it("the stand-in's clothes never come with the pose", () => {
    const guard = referenceIdentityGuard();
    expect(guard).toContain("The stand-in's clothes are not part of the pose");
    expect(guard).toContain('clothes of their own that show their own build');
    const r = compile(
      [
        { t: 'character', id: 'dax' },
        { t: 'text', v: ' posed like ' },
        { t: 'ref', imageHash: 'r1' },
      ],
      5,
    );
    expect(r.prompt).toContain("never in the stand-in's outfit");
  });

  it("the presenter's notes are claimed as theirs in every shot, accessories included", () => {
    const [notes] = characterFactDirectives(dax);
    expect(notes).toBe(
      "Dax's own, in every shot and never capture context, as part of who they are: gold aviator sunglasses, a wave tattoo on the inside of his right forearm.",
    );
  });

  it('hair rides as words; the brief can restyle it, never recolour it', () => {
    expect(hairDirective('Dax', 'long platinum waves', 'at a window')).toBe(
      "Dax's hair, exactly as their references show it: long platinum waves.",
    );
    expect(hairDirective('Dax', 'long platinum waves', 'hair tied back in a low bun')).toBe(
      "Dax's hair keeps its own colour, length and texture (long platinum waves), styled the way this shot's words ask.",
    );
    // a scene's prose is not the person's words: only userWords decide
    const r = compile(
      [
        { t: 'character', id: 'dax' },
        { t: 'text', v: 'on a rooftop' },
      ],
      5,
    );
    expect(r.prompt).toContain(
      "Dax's hair, exactly as their references show it: long platinum waves with darker roots.",
    );
  });

  it('a trait an old hard slice cut mid-word is mended to its last whole clause', () => {
    expect(mendedTrait(dax.build, 200)).toBe(
      'The visible upper body has broad shoulders relative to the neck, defined collarbones and a lean, muscular upper ' +
        'chest. Height and overall leanness are supplied as tall and lean.',
    );
    // clean text, or text that never reached the cap, is untouched
    expect(mendedTrait('broad and muscular, athletic', 200)).toBe('broad and muscular, athletic');
    expect(mendedTrait('Tall. Lean.', 11)).toBe('Tall. Lean.');
    // Deps' real stored face line: a clause cut here would leave "The nose has a straight."
    const face =
      'Long rectangular-to-oval face with a broad forehead, prominent cheekbones, subtly hollow cheeks and an angular ' +
      'jaw ending in a broad squared chin. Almond-shaped green eyes with slightly hooded upper lids sit beneath thick, ' +
      'dark, gently arched brows. The nose has a straight, moderately broad bridge,';
    expect(mendedTrait(face, face.length)).toBe(face.slice(0, face.indexOf(' The nose')));
    const r = compile([{ t: 'character', id: 'dax' }], 5);
    expect(r.prompt).not.toContain('full-body proporti');
    expect(r.prompt).toContain('supplied as tall and lean.');
  });

  it('with a presenter attached, a dropped shot of someone else is never described in its words', () => {
    const r = compile(
      [
        { t: 'character', id: 'dax' },
        { t: 'product', id: 'p1' },
        { t: 'ref', imageHash: 'old-shot' },
      ],
      2,
      () => 'a woman in her late thirties with shoulder-length auburn hair',
    );
    expect(r.dropped.map((d) => d.hash)).toContain('old-shot');
    expect(r.prompt).not.toContain('auburn');
  });
});
