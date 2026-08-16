import { describe, it, expect } from 'vitest';
import { canAutoOpen, type AutoOpenSignals } from '../src/app/whatsNewRules.js';

const quiet = (over: Partial<AutoOpenSignals> = {}): AutoOpenSignals => ({
  unread: true,
  spent: false,
  loaded: true,
  visible: true,
  dialogOpen: false,
  running: 0,
  builds: 0,
  ...over,
});

describe('canAutoOpen', () => {
  it('opens on a quiet, loaded, foreground screen with unread notes', () => {
    expect(canAutoOpen(quiet())).toBe(true);
  });

  it('says nothing when the notes have already been acknowledged', () => {
    expect(canAutoOpen(quiet({ unread: false }))).toBe(false);
  });

  it('gets exactly one chance per session', () => {
    expect(canAutoOpen(quiet({ spent: true }))).toBe(false);
  });

  it('never lands on top of creative work', () => {
    expect(canAutoOpen(quiet({ running: 1 }))).toBe(false);
    expect(canAutoOpen(quiet({ builds: 1 }))).toBe(false);
  });

  it('never stacks on a dialog that is already open', () => {
    expect(canAutoOpen(quiet({ dialogOpen: true }))).toBe(false);
  });

  it('waits for the brand to finish loading, and for the tab to be in front', () => {
    expect(canAutoOpen(quiet({ loaded: false }))).toBe(false);
    expect(canAutoOpen(quiet({ visible: false }))).toBe(false);
  });

  it('needs every clause at once — one busy signal is enough to hold it back', () => {
    expect(canAutoOpen(quiet({ running: 2, visible: true, loaded: true }))).toBe(false);
  });
});
