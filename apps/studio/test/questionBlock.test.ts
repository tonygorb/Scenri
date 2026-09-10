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
  on: { onAnswer?: (a: Answer) => void; onCancel?: () => void; onDescribe?: () => void } = {},
) =>
  act(() => {
    root.render(
      createElement(QuestionBlock, {
        question,
        onAnswer: on.onAnswer ?? (() => undefined),
        onCancel: on.onCancel,
        onDescribe: on.onDescribe,
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
