import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionBlock } from '../src/conversation/QuestionBlock.js';
import type { Answer, Question } from '../src/conversation/question.js';

/**
 * The block is dumb on purpose: it lights what it was given, hands back what
 * was tapped, and knows nothing of what either means.
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

const render = (
  question: Question,
  on: { onAnswer?: (a: Answer) => void; onCancel?: () => void; onDescribe?: () => void; busy?: boolean } = {},
) =>
  act(() => {
    root.render(
      createElement(QuestionBlock, {
        question,
        onAnswer: on.onAnswer ?? (() => undefined),
        onCancel: on.onCancel,
        onDescribe: on.onDescribe,
        busy: on.busy,
      }),
    );
  });
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

describe('a question block', () => {
  it('lights the choices it was given, and answers with what stands when Continue is tapped', () => {
    const onAnswer = vi.fn();
    render(
      {
        id: 'traits',
        kind: 'choice',
        prompt: 'Anything else?',
        multi: true,
        options: [
          { id: 'glasses', label: 'Glasses' },
          { id: 'tattoo', label: 'Tattoo' },
          { id: 'scar', label: 'Scar' },
        ],
        submit: 'Continue',
        given: ['glasses', 'tattoo'],
        reopened: true,
      },
      { onAnswer, onCancel: () => undefined },
    );
    expect(button('Glasses').getAttribute('aria-pressed')).toBe('true');
    expect(button('Tattoo').getAttribute('aria-pressed')).toBe('true');
    expect(button('Scar').getAttribute('aria-pressed')).toBe('false');
    // a block open again carries no line of its own, and a way to leave it
    expect(host.querySelector('.sc-convo-say')).toBeNull();
    expect(button('Cancel')).toBeTruthy();
    act(() => button('Tattoo').click());
    act(() => button('Scar').click());
    act(() => button('Continue').click());
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'choices', picks: { glasses: 'on', scar: 'on' } });
  });

  it('leaves an answer as it was from Cancel, and answers a decision once', () => {
    const onCancel = vi.fn();
    const onAnswer = vi.fn();
    render(
      {
        id: 'agree',
        kind: 'confirm',
        prompt: 'Shall I draw them?',
        options: [
          { id: 'draw', label: 'Draw them' },
          { id: 'add', label: 'Add a detail' },
        ],
        reopened: true,
      },
      { onAnswer, onCancel },
    );
    act(() => button('Cancel').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
    act(() => button('Draw them').click());
    act(() => button('Draw them').click());
    // the second tap lands on a block already answered, and is not a second answer
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'confirm', id: 'draw' });
  });

  it('offers a decision a way to say something instead, and the same word closes it again', () => {
    const onDescribe = vi.fn();
    const onAnswer = vi.fn();
    const say = (saying: boolean) =>
      render(
        {
          id: 'agree',
          kind: 'confirm',
          prompt: 'Shall I draw them?',
          options: [{ id: 'draw', label: 'Draw them' }],
          describe: 'Add a detail',
          saying,
        },
        { onAnswer, onDescribe },
      );
    say(false);
    expect(button('Add a detail').getAttribute('aria-pressed')).toBe('false');
    expect(button('Add a detail').dataset.on).toBeUndefined();
    act(() => button('Add a detail').click());
    expect(onDescribe).toHaveBeenCalledTimes(1);
    // it is a way in, never an answer: the decision is still open
    expect(onAnswer).not.toHaveBeenCalled();
    // and while the line is open it is lit, so the same word is the way out
    say(true);
    expect(button('Add a detail').getAttribute('aria-pressed')).toBe('true');
    expect(button('Add a detail').dataset.on).toBe('true');
    act(() => button('Add a detail').click());
    expect(onDescribe).toHaveBeenCalledTimes(2);
  });

  it('shows a fresh question with its line and nothing lit', () => {
    render({
      id: 'gaps',
      kind: 'choice',
      prompt: 'One thing I cannot tell yet.',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    expect(host.querySelector('.sc-convo-say')?.textContent).toContain('One thing I cannot tell yet.');
    expect(host.querySelectorAll('[data-on]').length).toBe(0);
    expect(button('Cancel')).toBeUndefined();
  });
});

describe('a block held while an earlier answer is changed', () => {
  it('is live again once the change is left, so the tap that opened it takes nothing', () => {
    const onAnswer = vi.fn();
    const q: Question = {
      id: 'agree-0',
      kind: 'confirm',
      prompt: 'Ready to draw?',
      options: [
        { id: 'draw', label: 'Draw the scene' },
        { id: 'another-shot', label: 'Choose another shot' },
      ],
    };
    render(q, { onAnswer });
    act(() => button('Choose another shot').click());
    expect(onAnswer).toHaveBeenLastCalledWith({ kind: 'confirm', id: 'another-shot' });
    // the answer it opened is being changed: this block waits, dim
    render(q, { onAnswer, busy: true });
    // left as it was: the block is the question on the floor again
    render(q, { onAnswer });
    act(() => button('Draw the scene').click());
    expect(onAnswer).toHaveBeenLastCalledWith({ kind: 'confirm', id: 'draw' });
  });
});

describe('a pick', () => {
  // the first three share one picture, as a shot and its reruns do; the rest are their own
  const hashOf = (i: number) => (i < 3 ? 'a' : 'bcdef'[i - 3]).repeat(32);
  const items = (n: number, from = 0) =>
    Array.from({ length: n }, (_, k) => ({ id: `n${from + k}`, hash: hashOf(from + k), alt: `Shot ${from + k}` }));
  const pick = (over: Partial<Extract<Question, { kind: 'pick' }>> = {}): Question => ({
    id: 'shot',
    kind: 'pick',
    prompt: 'Which shot?',
    items: items(3),
    search: { label: 'Find a shot', value: '' },
    empty: 'Nothing here.',
    back: 'Back to pictures',
    ...over,
  });
  const cards = () => [...host.querySelectorAll('.sc-convo-pick-grid > button')];

  it('gives every item its own card, even two sharing one picture, and lights only the one tapped', () => {
    const onAnswer = vi.fn();
    render(pick(), { onAnswer });
    expect(cards()).toHaveLength(3);
    act(() => (cards()[1] as HTMLButtonElement).click());
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'pick', action: { type: 'pick', id: 'n1' } });
    expect(cards().map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });

  it('leaves no card behind as a search narrows and widens, and the box stays the same box', () => {
    render(pick({ items: items(8) }));
    const box = host.querySelector('.sc-convo-pick-scroll');
    render(pick({ items: items(2, 5), search: { label: 'Find a shot', value: 'a' } }));
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['Shot 5', 'Shot 6']);
    render(pick({ items: [], search: { label: 'Find a shot', value: 'ab' } }));
    expect(cards()).toHaveLength(0);
    expect(host.querySelector('.sc-convo-pick-empty')?.textContent).toBe('Nothing here.');
    // still reading: no empty line claims there is nothing
    render(pick({ items: [], loading: true, search: { label: 'Find a shot', value: 'abc' } }));
    expect(host.querySelector('.sc-convo-pick-empty')).toBeNull();
    render(pick({ items: items(2, 1) }));
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(['Shot 1', 'Shot 2']);
    render(pick({ items: items(8) }));
    expect(cards()).toHaveLength(8);
    expect(host.querySelector('.sc-convo-pick-scroll')).toBe(box);
  });

  it('hands back what is typed, the way back, and the next page once its end is in view', () => {
    const onAnswer = vi.fn();
    const seen: ((e: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
          seen.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      render(pick({ more: true }), { onAnswer });
      const field = host.querySelector('.sc-convo-pick-q') as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      act(() => {
        set?.call(field, 'harbour');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(onAnswer).toHaveBeenCalledWith({ kind: 'pick', action: { type: 'query', text: 'harbour' } });
      act(() => seen[seen.length - 1]([{ isIntersecting: true }]));
      expect(onAnswer).toHaveBeenCalledWith({ kind: 'pick', action: { type: 'more' } });
      // a page already being read is not asked for twice
      onAnswer.mockClear();
      render(pick({ more: true, loading: true }), { onAnswer });
      act(() => seen[seen.length - 1]([{ isIntersecting: true }]));
      expect(onAnswer).not.toHaveBeenCalled();
      act(() => button('Back to pictures').click());
      expect(onAnswer).toHaveBeenCalledWith({ kind: 'pick', action: { type: 'back' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('empties a search on Escape before Escape may leave, and says what settled', () => {
    const onAnswer = vi.fn();
    render(pick({ search: { label: 'Find a shot', value: 'har' }, status: '3 shots' }), { onAnswer });
    const field = host.querySelector('.sc-convo-pick-q') as HTMLInputElement;
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      field.dispatchEvent(esc);
    });
    expect(esc.defaultPrevented).toBe(true);
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'pick', action: { type: 'query', text: '' } });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('3 shots');
    // an empty field lets Escape through, to the studio
    render(pick({ search: { label: 'Find a shot', value: '' } }), { onAnswer });
    const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      (host.querySelector('.sc-convo-pick-q') as HTMLInputElement).dispatchEvent(again);
    });
    expect(again.defaultPrevented).toBe(false);
  });

  it('holds the plates the first page will fill while it is read, and names the box by its question', () => {
    render(pick({ items: [], loading: true, status: '12 shots' }));
    expect(host.querySelectorAll('.sc-convo-pick-wait')).toHaveLength(8);
    expect(host.querySelector('.sc-convo-pick-empty')).toBeNull();
    // nothing is said while it is still being read
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
    const box = host.querySelector('fieldset.sc-convo-pick-scroll');
    expect(box?.getAttribute('aria-labelledby')).toBe('sc-convo-q-shot');
    render(pick({ items: items(2) }));
    expect(host.querySelectorAll('.sc-convo-pick-wait')).toHaveLength(0);
  });

  it('offers a picture question its quiet other way in', () => {
    const onAnswer = vi.fn();
    render(
      {
        id: 'photos',
        kind: 'photos',
        prompt: 'Add pictures.',
        hashes: [],
        max: 4,
        busy: false,
        submit: 'Read them',
        instead: 'Or start from one of your shots',
      },
      { onAnswer },
    );
    act(() => button('Or start from one of your shots').click());
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'photos', action: { type: 'instead' } });
  });

  it('holds the place of a way in that is not known yet, unseen and out of reach', () => {
    const onAnswer = vi.fn();
    render(
      {
        id: 'photos',
        kind: 'photos',
        prompt: 'Add pictures.',
        hashes: [],
        max: 4,
        busy: false,
        submit: 'Read them',
        instead: 'Or start from one of your shots',
        insteadWaiting: true,
      },
      { onAnswer },
    );
    const link = host.querySelector('.sc-convo-other') as HTMLButtonElement;
    expect(link.hasAttribute('data-waiting')).toBe(true);
    expect(link.getAttribute('aria-hidden')).toBe('true');
    expect(link.tabIndex).toBe(-1);
    act(() => link.click());
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

// A press whose request failed at once is asked again under the same id: the
// block never went, so it kept the tapped control lit and took nothing more.
// A new attempt count hands it back.
describe('a question asked again after its press failed', () => {
  const draw = (attempt?: number): Question => ({
    id: 'agree-0',
    kind: 'confirm',
    prompt: 'Ready to draw?',
    options: [{ id: 'draw', label: 'Draw the scene' }],
    ...(attempt ? { attempt } : {}),
  });
  it('takes a press again once the attempt changes', () => {
    const onAnswer = vi.fn();
    render(draw(), { onAnswer });
    act(() => button('Draw the scene').click());
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-picked]')).not.toBeNull();
    // still latched while nothing changed: a second tap takes nothing
    act(() => button('Draw the scene').click());
    expect(onAnswer).toHaveBeenCalledTimes(1);
    render(draw(1), { onAnswer });
    expect(host.querySelector('[data-picked]')).toBeNull();
    act(() => button('Draw the scene').click());
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });
});

// UXS-4: on a phone the picture being decided sat above a full read-back the
// person had just agreed to, and scrolled off. Words already read out stand at
// their first line, with the rest one press away.
describe('a quote already read out', () => {
  const decide = (quoteFolded?: boolean): Question => ({
    id: 'decide-1',
    kind: 'confirm',
    prompt: 'Use it?',
    quote: 'A wet basalt shelf at the waterline.\nLow sunset.',
    quoteLabel: 'What your shots are told',
    ...(quoteFolded ? { quoteFolded } : {}),
    options: [{ id: 'use', label: 'Use it' }],
  });
  it('stands folded, and opens whole on Show all', () => {
    render(decide(true));
    const text = host.querySelector('.sc-convo-brief-text') as HTMLElement;
    expect(text.hasAttribute('data-folded')).toBe(true);
    expect(text.textContent).toContain('Low sunset.');
    const more = button('Show all');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    act(() => more.click());
    expect(text.hasAttribute('data-folded')).toBe(false);
    expect(button('Show all')).toBeUndefined();
  });
  it('stands whole when it was not read out before', () => {
    render(decide());
    expect(host.querySelector('.sc-convo-brief-text')?.hasAttribute('data-folded')).toBe(false);
    expect(button('Show all')).toBeUndefined();
  });
});
