import { describe, it, expect } from 'vitest';
import { generationMessages, type NodeStatusLite } from '../src/liveStatus.js';

const node = (id: string, status: string, images: string[] = [], error?: string): NodeStatusLite => ({
  id,
  status,
  images,
  error,
});

describe('generationMessages', () => {
  it('announces a new running shot, its landing, and its failure', () => {
    let state = generationMessages(new Map(), []);
    state = generationMessages(state.next, [node('a', 'running')]);
    expect(state.messages).toEqual(['Generating shot.']);
    state = generationMessages(state.next, [node('a', 'done', ['h1', 'h2'])]);
    expect(state.messages).toEqual(['Shot ready.']);
    state = generationMessages(state.next, [node('a', 'done', ['h1', 'h2']), node('b', 'running')]);
    expect(state.messages).toEqual(['Generating shot.']);
    state = generationMessages(state.next, [node('a', 'done', ['h1', 'h2']), node('b', 'error', [], 'rate limited')]);
    expect(state.messages).toEqual(['Shot failed: rate limited']);
  });

  it('says nothing for unchanged statuses or finished shots arriving cold', () => {
    let state = generationMessages(new Map(), [node('a', 'done', ['h1'])]);
    // the caller skips the first diff anyway; even unskipped, a cold done says nothing
    expect(state.messages).toEqual([]);
    state = generationMessages(state.next, [node('a', 'done', ['h1'])]);
    expect(state.messages).toEqual([]);
  });

  it('announces a cancel as a cancel, and a landing as ready', () => {
    let state = generationMessages(new Map(), [node('a', 'running')]);
    state = generationMessages(state.next, [node('a', 'cancelled')]);
    expect(state.messages).toEqual(['Shot cancelled.']);
    state = generationMessages(new Map([['b', 'running']]), [node('b', 'done', ['h1'])]);
    expect(state.messages).toEqual(['Shot ready.']);
  });

  // A partial answer (the one to four records a send or a keep returns) used
  // to replace the map, so the next poll took every other shot for new and
  // said nothing when they landed.
  it('keeps every status it has heard when an answer holds only some of them', () => {
    let state = generationMessages(new Map(), [node('a', 'running'), node('b', 'running')]);
    state = generationMessages(state.next, [node('c', 'running')]);
    state = generationMessages(state.next, [node('a', 'done', ['h']), node('b', 'running'), node('c', 'running')]);
    expect(state.messages).toEqual(['Shot ready.']);
  });

  it('says a batch once, not once per sibling', () => {
    let state = generationMessages(new Map(), []);
    state = generationMessages(state.next, [
      node('a', 'running'),
      node('b', 'running'),
      node('c', 'running'),
      node('d', 'running'),
    ]);
    expect(state.messages).toEqual(['Generating 4 shots.']);
    state = generationMessages(state.next, [
      node('a', 'done', ['h']),
      node('b', 'done', ['h']),
      node('c', 'error', [], 'x'),
      node('d', 'error', [], 'y'),
    ]);
    expect(state.messages).toEqual(['2 shots ready.', '2 shots failed.']);
  });
});
