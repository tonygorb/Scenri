import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioFrame } from '../src/create/studio/StudioFrame.js';

/**
 * The seam between stage and rail is a focusable splitter, and it used to be
 * the studio's first Tab stop: a keyboard reader met "Resize the
 * conversation" before Close and before anything to answer. The rail's width
 * is a preference, not the work, so it is reached last.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('the studio frame', () => {
  it('reaches the seam after the conversation and its composer, never first', () => {
    act(() => {
      root.render(
        createElement(
          Theme,
          null,
          createElement(StudioFrame, {
            title: 'Create a scene',
            kind: 'scene',
            resizeLabel: 'Resize the conversation',
            stage: createElement('div'),
            body: createElement('button', { type: 'button' }, 'Guide me'),
            foot: createElement('textarea', { 'aria-label': 'Message' }),
            onClose: () => {},
          }),
        ),
      );
    });
    const studio = document.querySelector('.sc-pstudio');
    const stops = [...(studio?.querySelectorAll<HTMLElement>('button, textarea, [tabindex="0"]') ?? [])];
    // Tab walks document order here: nothing in the frame sets a positive tabIndex.
    expect(stops.map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual([
      'Close',
      'Close',
      'Guide me',
      'Message',
      'Resize the conversation',
    ]);
  });
});
