import { describe, expect, it } from 'vitest';
import { splitCaption } from '../src/views/PresenterDetailsDialog.js';

const SEP = ' · ';
const join = (parts: string[]) => parts.join(SEP);

describe('a caption is a list stored as a string', () => {
  it('comes apart into the phrases Scenri wrote', () => {
    expect(splitCaption('Solid build · textured grey hair · defined jaw')).toEqual([
      'Solid build',
      'textured grey hair',
      'defined jaw',
    ]);
  });

  it('goes back together exactly as it was', () => {
    // Every descriptor in a real library is three phrases with an interpunct
    // between them, so a round trip has to be the identity or editing one
    // phrase would rewrite the caption of every presenter that is saved.
    for (const caption of [
      'Solid build · black waves · defined brows',
      'Athletic build · copper curls · freckled complexion',
      'Androgynous presence · cropped white hair · freckled skin',
    ]) {
      expect(join(splitCaption(caption))).toBe(caption);
    }
  });

  it('takes a caption that was never a list as one phrase', () => {
    expect(splitCaption('A quiet sort of person')).toEqual(['A quiet sort of person']);
  });

  it('drops the empty pieces a half-typed separator leaves', () => {
    expect(splitCaption('Solid build ·  · defined jaw')).toEqual(['Solid build', 'defined jaw']);
    expect(splitCaption('')).toEqual([]);
    expect(splitCaption(' · ')).toEqual([]);
  });

  it('does not mind the spacing around the separator', () => {
    expect(splitCaption('Solid build·textured grey hair')).toEqual(['Solid build', 'textured grey hair']);
  });
});
