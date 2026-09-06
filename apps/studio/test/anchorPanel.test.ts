import { describe, it, expect } from 'vitest';
import {
  placePanel,
  PANEL_W,
  PANEL_MAX_H,
  type AnchorRect,
  placeBeside,
  PREVIEW_H,
} from '../src/composer/anchorPanel.js';
import {
  INSERT_MENU_MAX_H,
  INSERT_MENU_PHONE_MAX_H,
  INSERT_MENU_W,
  placeInsertMenu,
} from '../src/composer/placeInsertMenu.js';

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

  it('honours a narrower requested width and still clamps on a tight viewport', () => {
    const wide = placePanel(chip(), DESKTOP, { width: 260 });
    expect(wide?.width).toBe(260);
    const tight = placePanel(chip({ left: 20, right: 120 }), { width: 240, height: 844 }, { width: 260 });
    expect(tight?.width).toBe(240 - 24);
    expect(tight?.left).toBe(12);
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

const composer = (over: Partial<AnchorRect> = {}): AnchorRect => ({
  top: 720,
  bottom: 880,
  left: 360,
  right: 1080,
  ...over,
});

const caret = (over: Partial<AnchorRect> = {}): AnchorRect => ({
  top: 748,
  bottom: 766,
  left: 420,
  right: 428,
  ...over,
});

describe('placeInsertMenu', () => {
  it('anchors above the caret on desktop when there is room', () => {
    const p = placeInsertMenu(caret(), composer(), DESKTOP);
    expect(p?.shell).toBe('caret');
    expect(p?.side).toBe('above');
    expect(p?.width).toBe(INSERT_MENU_W);
    expect(p?.maxHeight).toBeLessThanOrEqual(INSERT_MENU_MAX_H);
    expect(p!.top + p!.maxHeight).toBeLessThanOrEqual(caret().top);
  });

  it('hangs off the line start when the caret rect is untrustworthy', () => {
    const p = placeInsertMenu({ top: 0, bottom: 0, left: 0, right: 0 }, composer(), DESKTOP);
    expect(p?.side).toBe('above');
    expect(p?.left).toBe(composer().left);
    expect(p!.top + p!.maxHeight).toBeLessThanOrEqual(composer().top);
  });

  it('hangs off the line start when the caret is null', () => {
    const p = placeInsertMenu(null, composer(), DESKTOP);
    expect(p?.left).toBe(composer().left);
    expect(p!.top + p!.maxHeight).toBeLessThanOrEqual(composer().top);
  });

  it('stays inside the visual viewport, not the layout viewport', () => {
    const vp = { width: 390, height: 430 };
    const brief = composer({ top: 360, bottom: 500, left: 12, right: 378 });
    const p = placeInsertMenu(caret({ top: 380, bottom: 398, left: 40, right: 48 }), brief, vp);
    expect(p).not.toBeNull();
    expect(p!.top).toBeGreaterThanOrEqual(0);
    expect(p!.top + p!.maxHeight).toBeLessThanOrEqual(vp.height);
  });

  it('docks to the composer on the phone, ignoring the caret', () => {
    const vp = { width: 390, height: 430 };
    const brief = composer({ top: 300, bottom: 430, left: 12, right: 378 });
    const p = placeInsertMenu(caret({ top: 320, bottom: 338, left: 40, right: 48 }), brief, vp, { phone: true });
    expect(p?.shell).toBe('dock');
    expect(p?.left).toBe(brief.left);
    expect(p?.width).toBe(brief.right - brief.left);
    expect(p?.maxHeight).toBeLessThanOrEqual(INSERT_MENU_PHONE_MAX_H);
    expect(p?.maxHeight).toBeLessThanOrEqual(Math.floor(vp.height * 0.4));
    expect(p!.top + p!.maxHeight).toBeLessThanOrEqual(brief.top);
  });

  it('never grows off the top of a short visual viewport', () => {
    const vp = { width: 390, height: 200 };
    const brief = composer({ top: 120, bottom: 200, left: 12, right: 378 });
    const p = placeInsertMenu(null, brief, vp, { phone: true });
    expect(p).not.toBeNull();
    expect(p!.top).toBeGreaterThanOrEqual(8);
    expect(p!.top + p!.maxHeight).toBeLessThanOrEqual(brief.top);
  });

  it('collapses an empty-line box to the text start, not the middle of the composer', () => {
    // An empty contenteditable reports the whole line as the caret. Using that
    // left as-is is fine; using its centre is how the menu floated over Generate.
    const lineBox = { top: 740, bottom: 780, left: 374, right: 1066 };
    const p = placeInsertMenu(lineBox, composer(), DESKTOP);
    expect(p?.shell).toBe('caret');
    expect(p?.left).toBe(374);
  });

  it('sits just above the caret when the box is only an empty state', () => {
    const p = placeInsertMenu(caret(), composer(), DESKTOP, { height: 80 });
    expect(p?.side).toBe('above');
    expect(p?.shell).toBe('caret');
    expect(p?.maxHeight).toBe(80);
    // 748 caret - 8 gap - 80 box
    expect(p?.top).toBe(660);
    expect(p!.top + 80).toBe(caret().top - 8);
  });

  it('does not dock a short intentional box as an unusable sliver', () => {
    const p = placeInsertMenu(caret(), composer(), DESKTOP, { height: 60 });
    expect(p?.shell).toBe('caret');
    expect(p?.maxHeight).toBe(60);
    expect(p!.top + 60).toBe(caret().top - 8);
  });

  it('docks a short empty box just above the composer on the phone', () => {
    const vp = { width: 390, height: 430 };
    const brief = composer({ top: 300, bottom: 430, left: 12, right: 378 });
    const p = placeInsertMenu(caret({ top: 320, bottom: 338, left: 40, right: 48 }), brief, vp, {
      phone: true,
      height: 80,
    });
    expect(p?.shell).toBe('dock');
    expect(p?.maxHeight).toBe(80);
    expect(p!.top + 80).toBe(brief.top - 8);
  });
});

describe('placeBeside', () => {
  const vp = { width: 1440, height: 900 };
  const tile = (top: number) => ({ top, bottom: top + 52, left: 14, right: 66 });

  it('opens to the right of the tile, level with its top', () => {
    const p = placeBeside(tile(300), vp)!;
    expect(p.side).toBe('beside');
    expect(p.left).toBe(66 + 8);
    expect(p.top).toBe(300);
  });

  it('pulls up at the bottom of the screen so the whole card stays on it', () => {
    const p = placeBeside(tile(860), vp)!;
    expect(p.top).toBe(900 - 12 - PREVIEW_H);
    expect(p.top + PREVIEW_H).toBeLessThanOrEqual(900 - 12);
  });

  it('goes to the left when there is no room on the right, and closes when the tile has left the screen', () => {
    const p = placeBeside({ top: 300, bottom: 352, left: 1380, right: 1432 }, vp)!;
    expect(p.left).toBe(1380 - 8 - p.width);
    expect(placeBeside(tile(-100), vp)).toBeNull();
    expect(placeBeside(tile(950), vp)).toBeNull();
  });
});
