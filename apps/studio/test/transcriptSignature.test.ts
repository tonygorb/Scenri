import { describe, expect, it } from 'vitest';
import { signatureOf } from '../src/conversation/Transcript.js';
import type { Turn } from '../src/conversation/question.js';

const line = (id: string, text: string): Turn => ({ kind: 'scenri', id, text });
const said = (id: string, text: string): Turn => ({ kind: 'you', id, text });
const asked = (id: string, prompt: string, reopened?: boolean): Turn => ({
  kind: 'question',
  question: { kind: 'text', id, prompt, ...(reopened ? { reopened: true } : {}) },
});

/**
 * The guard that decides whether the conversation moved.
 *
 * A flow waiting on a picture reads its draft again every 1500ms, and every
 * read builds a new turns array saying exactly the same thing. The transcript
 * used to treat a new array as a change, which armed the slide and pulled
 * every turn through a 220ms move: on screen, the conversation reloading and
 * sliding every few seconds while nothing was happening.
 */
describe('what the turns say', () => {
  it('is the same for a list rebuilt with the same words in it', () => {
    const once = [line('opening', 'Here is the face.'), said('ask-1', 'shorter hair'), asked('scope', 'Which view?')];
    const again = [line('opening', 'Here is the face.'), said('ask-1', 'shorter hair'), asked('scope', 'Which view?')];
    expect(once).not.toBe(again);
    expect(signatureOf(once)).toBe(signatureOf(again));
  });

  it('changes when a turn arrives', () => {
    const before = [line('opening', 'Here is the face.')];
    expect(signatureOf([...before, line('drawing-front', 'Redrawing the full body.')])).not.toBe(signatureOf(before));
  });

  it('changes when a turn goes', () => {
    const before = [line('a', 'one'), line('b', 'two')];
    expect(signatureOf([before[0]])).not.toBe(signatureOf(before));
  });

  it('changes when the words in a turn change', () => {
    expect(signatureOf([line('a', 'Drawing the face.')])).not.toBe(signatureOf([line('a', 'Redrawing the face.')]));
  });

  it('changes when two turns swap places', () => {
    const a = line('a', 'one');
    const b = line('b', 'two');
    expect(signatureOf([a, b])).not.toBe(signatureOf([b, a]));
  });

  it('changes when a question opens again from its answer', () => {
    expect(signatureOf([asked('scope', 'Which view?')])).not.toBe(signatureOf([asked('scope', 'Which view?', true)]));
  });

  it('changes when a picture appears under a line', () => {
    const plain: Turn = { kind: 'scenri', id: 'a', text: 'Here is the face.' };
    const withPicture: Turn = { kind: 'scenri', id: 'a', text: 'Here is the face.', thumb: 'abc123' };
    expect(signatureOf([withPicture])).not.toBe(signatureOf([plain]));
  });

  it('tells two turns apart that say the same thing', () => {
    expect(signatureOf([line('a', 'same'), line('b', 'same')])).not.toBe(signatureOf([line('a', 'same')]));
  });
});
