import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { RevealWords } from '../src/conversation/ScenriTurn.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The log a line lands in is a polite live region that announces additions.
// Once the words had played they were swapped for a new text node, which the
// region heard as the line arriving again: a screen reader said it twice.
describe('a line whose words have played', () => {
  it('keeps the nodes it arrived in, so the log hears it once', () => {
    const host = document.createElement('p');
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(RevealWords, { text: 'Here is the face.', playing: true })));
    const first = host.firstChild;
    expect(host.querySelectorAll('.sc-convo-w').length).toBeGreaterThan(1);
    act(() => root.render(createElement(RevealWords, { text: 'Here is the face.', playing: false })));
    expect(host.firstChild).toBe(first);
    expect(host.textContent).toBe('Here is the face.');
    act(() => root.unmount());
    host.remove();
  });
  it('is plain text when it never played', () => {
    const host = document.createElement('p');
    const root = createRoot(host);
    act(() => root.render(createElement(RevealWords, { text: 'Saved.', playing: false })));
    expect(host.querySelector('.sc-convo-w')).toBeNull();
    expect(host.textContent).toBe('Saved.');
    act(() => root.unmount());
  });
});
