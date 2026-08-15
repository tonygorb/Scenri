import { describe, it, expect } from 'vitest';
import { placePanel, PANEL_W, PANEL_MAX_H, type AnchorRect } from '../src/composer/anchorPanel.js';

const DESKTOP = { width: 1440, height: 900 };

/** A chip sitting in the composer, which lives at the bottom of every mount. */
const chip = (over: Partial<AnchorRect> = {}): AnchorRect => ({
  top: 760,
  bottom: 782,
  left: 420,
  right: 520,
  ...over,
});

describe('placePanel', () => {
  it('opens above by default — the composer is at the bottom, so upward never covers the brief', () => {
    const p = placePanel(chip(), DESKTOP);
    expect(p?.side).toBe('above');
    // 760 - 8 gap - 460 tall
    expect(p?.top).toBe(292);
    expect(p?.maxHeight).toBe(PANEL_MAX_H);
  });

  it('flips below when the band above is too short to browse in', () => {
    // a chip near the top of a short viewport: 40px above, plenty under it
    const p = placePanel(chip({ top: 40, bottom: 62 }), { width: 1280, height: 700 });
    expect(p?.side).toBe('below');
    expect(p?.top).toBe(70);
  });

  it('still prefers above when above is the larger of two cramped bands', () => {
    const p = placePanel(chip({ top: 200, bottom: 222 }), { width: 1280, height: 300 });
    expect(p?.side).toBe('above');
  });

  it('shrinks to the band rather than growing off-screen', () => {
    const p = placePanel(chip({ top: 300, bottom: 322 }), { width: 1280, height: 900 });
    // 300 - 8 - 12 = 280 of room, less than the 460 it would like
    expect(p?.maxHeight).toBe(280);
    expect(p?.top).toBe(12);
  });

  it('never returns a box that starts above the viewport, however tall the content wants to be', () => {
    for (const top of [30, 80, 150, 400, 860]) {
      const p = placePanel(chip({ top, bottom: top + 22 }), DESKTOP);
      expect(p).not.toBeNull();
      expect(p!.top).toBeGreaterThanOrEqual(12);
      expect(p!.top + p!.maxHeight).toBeLessThanOrEqual(DESKTOP.height);
    }
  });

  it('floors the height at 200 so a flip is chosen before an unusable scroller is', () => {
    const p = placePanel(chip({ top: 60, bottom: 82 }), { width: 1280, height: 120 });
    expect(p?.maxHeight).toBe(200);
  });

  it('clamps left at the right edge', () => {
    const p = placePanel(chip({ left: 1400, right: 1430 }), DESKTOP);
    expect(p?.left).toBe(DESKTOP.width - PANEL_W - 12);
  });

  it('clamps left at the left edge', () => {
    const p = placePanel(chip({ left: -40, right: 60 }), DESKTOP);
    expect(p?.left).toBe(12);
  });

  it('narrows the panel on a viewport too small to hold it', () => {
    const p = placePanel(chip({ left: 20, right: 120 }), { width: 390, height: 844 });
    expect(p?.width).toBe(390 - 24);
    expect(p?.left).toBe(12);
  });

  it('returns null when the chip has scrolled out of its own 30vh scroller', () => {
    expect(placePanel(chip({ top: -60, bottom: -38 }), DESKTOP)).toBeNull();
    expect(placePanel(chip({ top: 980, bottom: 1002 }), DESKTOP)).toBeNull();
  });

  it('stays inside the visual viewport when a software keyboard is up', () => {
    // The layout viewport is still 844 tall; visualViewport reports 430.
    const withKeyboard = placePanel(chip({ top: 380, bottom: 402 }), { width: 390, height: 430 });
    expect(withKeyboard).not.toBeNull();
    expect(withKeyboard!.top + withKeyboard!.maxHeight).toBeLessThanOrEqual(430);
    // and measuring against the layout viewport is exactly the bug: it would
    // have chosen the other side and run off the bottom of what you can see
    const naive = placePanel(chip({ top: 380, bottom: 402 }), { width: 390, height: 844 });
    expect(naive!.side).toBe('above');
    expect(withKeyboard!.side).toBe('above');
  });
});
