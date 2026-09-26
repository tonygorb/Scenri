import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Closing the studio over a draft keeps it on the wall, and says so once
 * (UXP-16): the card was the only way to learn it had not been lost. Driven
 * through the studio's own close, with the flow and the shell stood in for.
 */
const push = vi.hoisted(() => vi.fn());
const flow = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../src/toasts.js', () => ({ useToasts: () => ({ push }) }));
vi.mock('../src/create/presenter/useCreationFlow.js', () => ({ useCreationFlow: () => flow.current }));
vi.mock('../src/create/presenter/StudioShell.js', () => ({
  StudioShell: ({ onClose }: { onClose: () => void }) =>
    createElement('button', { type: 'button', onClick: onClose }, 'Close'),
}));

const { PresenterCreate } = await import('../src/create/presenter/PresenterCreate.js');

let host: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

const open = (over: Record<string, unknown>) => {
  flow.current = {
    d: null,
    unsaved: false,
    saving: false,
    begun: true,
    open: null,
    surface: {},
    confirming: null,
    setConfirming: () => {},
    keepPrevious: null,
    ...over,
  };
  act(() =>
    root.render(
      createElement(PresenterCreate, {
        draftId: null,
        convoKey: 'k1',
        onOpenDraft: () => {},
        onLeaveDraft: () => {},
        onClose,
      }),
    ),
  );
};
const close = () => act(() => host.querySelector('button')?.click());
const slot = { status: 'empty', attempts: 0, rejected: [] };
const views = Object.fromEntries(['portrait', 'front', 'three-quarter', 'back', 'left', 'right'].map((v) => [v, slot]));
const drawing = { id: 'pd-1', name: '', views, activeView: 'portrait', stage: 'drawing' };

beforeEach(() => {
  push.mockReset();
  onClose.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('closing the studio', () => {
  it('over a draft says once that it is kept, and where to continue it', () => {
    open({ d: drawing });
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({
      kind: 'info',
      title: 'Kept on Presenters',
      detail: 'Continue it from its card.',
    });
  });

  it('with no draft says nothing, because nothing was kept', () => {
    open({ d: null });
    close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('while the draft is being saved says nothing, because it is becoming a presenter', () => {
    open({ d: drawing, saving: true });
    close();
    expect(push).not.toHaveBeenCalled();
  });
});
