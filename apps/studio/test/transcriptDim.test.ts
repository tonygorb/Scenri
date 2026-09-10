import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Transcript } from '../src/conversation/Transcript.js';
import type { Turn } from '../src/conversation/question.js';

/**
 * While one answer is being changed, that exchange is the conversation and
 * everything else steps back. The transcript decides it from the turns alone:
 * a question open again, or a sentence being rewritten in place.
 */
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (turns: Turn[]) =>
  act(() => {
    root.render(createElement(Transcript, { turns, memoryKey: undefined, onAnswer: () => undefined }));
  });

const dimmed = () =>
  [...host.querySelectorAll<HTMLElement>('.sc-convo-turn[data-dim]')].map((n) => n.dataset.turn ?? '');
const shown = () => [...host.querySelectorAll<HTMLElement>('.sc-convo-turn')].map((n) => n.dataset.turn ?? '');

const asked = (id: string, text: string): Turn => ({ kind: 'scenri', id: `asked-${id}`, text, quiet: true });
const said = (id: string, text: string): Turn => ({ kind: 'you', id, text, editable: true });

const ANSWERED: Turn[] = [
  { kind: 'you', id: 'intent', text: 'Create a presenter' },
  asked('look-who', 'Who are they?'),
  said('look-who', 'Woman'),
  asked('look-hair', 'What colour is their hair?'),
  said('look-hair', 'Brown'),
  asked('look-build', 'And their build?'),
  said('look-build', 'Lean'),
];

describe('a line already answered', () => {
  it('carries the time it was said, on both sides', () => {
    render([
      { kind: 'you', id: 'intent', text: 'Create a presenter' },
      asked('look-who', 'Who are they?'),
      said('look-who', 'Woman'),
    ]);
    const times = [...host.querySelectorAll<HTMLTimeElement>('.sc-convo-time')];
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.every((t) => !!t.dateTime)).toBe(true);
  });
});

describe('an answer being changed', () => {
  it('leaves nothing dim while the conversation simply runs', () => {
    render([...ANSWERED, { kind: 'question', question: { id: 'traits', kind: 'text', prompt: 'Anything else?' } }]);
    expect(shown().length).toBeGreaterThan(4);
    expect(dimmed()).toEqual([]);
  });

  it('keeps the exchange being changed and steps the rest back', () => {
    render([
      ...ANSWERED.slice(0, 4),
      {
        kind: 'question',
        question: { id: 'look-hair', kind: 'text', prompt: 'What colour is their hair?', reopened: true },
      },
      ...ANSWERED.slice(5),
    ]);
    // the question's own line and the thing being answered stand
    expect(dimmed()).not.toContain('scenri:asked-look-hair');
    expect(dimmed()).not.toContain('q:look-hair');
    // everything else steps back, before it and after it alike
    expect(dimmed()).toContain('you:look-who');
    expect(dimmed()).toContain('scenri:asked-look-who');
    expect(dimmed()).toContain('you:look-build');
    expect(dimmed()).toContain('you:intent');
  });

  it('stands the question the conversation is on, and lets it take no answer', () => {
    const openQuestion: Turn = {
      kind: 'question',
      question: {
        id: 'agree',
        kind: 'confirm',
        prompt: 'Shall I draw them?',
        options: [{ id: 'draw', label: 'Draw them' }],
      },
    };
    render([
      ...ANSWERED.slice(0, 4),
      {
        kind: 'question',
        question: { id: 'look-hair', kind: 'text', prompt: 'What colour is their hair?', reopened: true },
      },
      ...ANSWERED.slice(5),
      openQuestion,
    ]);
    // it is still there, so nothing under the reader is taken away
    expect(shown()).toContain('q:agree');
    expect(dimmed()).toContain('q:agree');
    // and it cannot be answered while the change is open
    const standing = host.querySelector<HTMLFieldSetElement>('.sc-convo-turn[data-turn="q:agree"] fieldset');
    expect(standing?.disabled).toBe(true);
    const open = host.querySelector<HTMLFieldSetElement>('.sc-convo-turn[data-turn="q:look-hair"] fieldset');
    expect(open?.disabled).toBe(false);
  });

  it('says the question again when the answer behind it changed, and not otherwise', () => {
    const standing: Turn = {
      kind: 'question',
      question: { id: 'traits', kind: 'confirm', prompt: 'Anything else?', options: [{ id: 'no', label: 'Nothing' }] },
    };
    const open: Turn = {
      kind: 'question',
      question: { id: 'look-who', kind: 'text', prompt: 'Who are they?', reopened: true },
    };
    const answered = (text: string): Turn[] => [
      { kind: 'you', id: 'intent', text: 'Create a presenter' },
      asked('look-who', 'Who are they?'),
      said('look-who', text),
      standing,
    ];
    const editing: Turn[] = [
      { kind: 'you', id: 'intent', text: 'Create a presenter' },
      asked('look-who', 'Who are they?'),
      open,
      standing,
    ];
    const arriving = () => host.querySelector('.sc-convo-turn[data-turn="q:traits"]')?.getAttribute('data-arrive');
    // asked once, answered, and the question that follows has been read
    render(answered('Woman'));
    render(editing);
    // closed on the same answer: nothing was said again
    render(answered('Woman'));
    expect(arriving()).toBeNull();
    // closed on a different one: the question that follows is asked again
    render(editing);
    render(answered('Man'));
    expect(arriving()).toBe('true');
  });

  it('does the same for a sentence being rewritten where it stands', () => {
    render([
      { kind: 'you', id: 'intent', text: 'Create a presenter' },
      asked('describe', 'Describe them.'),
      { kind: 'you', id: 'describe', text: 'a woman in her 30s', editable: true, editing: true },
      asked('traits', 'Anything else that is always true of them?'),
      said('traits', 'Nothing distinctive'),
    ]);
    expect(dimmed()).not.toContain('you:describe');
    expect(dimmed()).not.toContain('scenri:asked-describe');
    expect(dimmed()).toContain('you:traits');
    expect(dimmed()).toContain('you:intent');
  });
});
