import { describe, it, expect } from 'vitest';
import { canAutoOpen, moreLabel, type AutoOpenSignals } from '../src/app/whatsNewRules.js';
import { pictureUrl } from '../src/whatsNewPictures.js';

const quiet = (over: Partial<AutoOpenSignals> = {}): AutoOpenSignals => ({
  lead: true,
  spent: false,
  loaded: true,
  visible: true,
  dialogOpen: false,
  running: 0,
  builds: [],
  firstUse: false,
  onPage: false,
  ...over,
});

describe('canAutoOpen', () => {
  it('opens on a quiet, loaded, foreground screen with an unread headline update', () => {
    expect(canAutoOpen(quiet())).toBe(true);
  });

  it('never opens for a small update: those wait on the page and the Help mark', () => {
    expect(canAutoOpen(quiet({ lead: false }))).toBe(false);
  });

  it('gets exactly one chance per session', () => {
    expect(canAutoOpen(quiet({ spent: true }))).toBe(false);
  });

  it('never lands on top of creative work', () => {
    expect(canAutoOpen(quiet({ running: 1 }))).toBe(false);
    expect(canAutoOpen(quiet({ builds: [{ finished: false }] }))).toBe(false);
  });

  it('a finished build is history, not work in progress', () => {
    expect(canAutoOpen(quiet({ builds: [{ finished: true }, { finished: true }] }))).toBe(true);
    expect(canAutoOpen(quiet({ builds: [{ finished: true }, { finished: false }] }))).toBe(false);
  });

  it('never speaks while someone is being introduced to Scenri', () => {
    expect(canAutoOpen(quiet({ firstUse: true }))).toBe(false);
  });

  it('never stacks on a dialog that is already open', () => {
    expect(canAutoOpen(quiet({ dialogOpen: true }))).toBe(false);
  });

  it('says nothing on the What’s New page itself', () => {
    expect(canAutoOpen(quiet({ onPage: true }))).toBe(false);
  });

  it('waits for the brand to finish loading, and for the tab to be in front', () => {
    expect(canAutoOpen(quiet({ loaded: false }))).toBe(false);
    expect(canAutoOpen(quiet({ visible: false }))).toBe(false);
  });

  it('needs every clause at once: one busy signal is enough to hold it back', () => {
    expect(canAutoOpen(quiet({ running: 2, visible: true, loaded: true }))).toBe(false);
  });
});

describe('moreLabel', () => {
  it('counts the other updates waiting, and names all of them when there are none', () => {
    expect(moreLabel(0)).toBe('See all updates');
    expect(moreLabel(1)).toBe('See 1 more update');
    expect(moreLabel(3)).toBe('See 3 more updates');
  });
});

describe('pictureUrl', () => {
  it('resolves nothing for a picture the build does not carry, so the update reads as words', () => {
    expect(pictureUrl('9.9.9-missing.webp')).toBeNull();
    expect(pictureUrl('../../etc/passwd')).toBeNull();
  });
});
