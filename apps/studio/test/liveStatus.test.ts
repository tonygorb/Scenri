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
    expect(state.messages).toEqual(['Shot ready, 2 images.']);
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

  it('announces a cancel as a cancel, singular image grammar holds', () => {
    let state = generationMessages(new Map(), [node('a', 'running')]);
    state = generationMessages(state.next, [node('a', 'cancelled')]);
    expect(state.messages).toEqual(['Shot cancelled.']);
    state = generationMessages(new Map([['b', 'running']]), [node('b', 'done', ['h1'])]);
    expect(state.messages).toEqual(['Shot ready, 1 image.']);
  });
});
