import { describe, it, expect } from 'vitest';
import {
  intersects,
  opposite,
  pad,
  panels,
  referenceRect,
  ringRadius,
  trimBy,
  union,
  visibleRect,
  windowMask,
  windowsMask,
  windowsRim,
  sideWithRoom,
  type Box,
} from '../src/layout/coachGeometry.js';

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe('coach geometry', () => {
  it('a target is only as visible as the viewport and the pane it scrolls in let it be', () => {
    const viewport = box(0, 0, 1440, 900);
    const pane = box(0, 52, 1440, 900);
    expect(visibleRect(box(24, 322, 1405, 7200), [viewport, pane])).toEqual(box(24, 322, 1405, 900));
    expect(visibleRect(box(24, 10, 200, 40), [viewport, pane])).toBeNull();
    expect(visibleRect(box(24, 1000, 200, 1040), [viewport])).toBeNull();
  });

  it('the card is placed across the target and along the whole region', () => {
    const plus = box(214, 822, 260, 868);
    const composer = box(200, 760, 920, 882);
    expect(referenceRect(plus, composer, 'top')).toEqual(box(214, 760, 260, 882));
    expect(referenceRect(plus, composer, 'right')).toEqual(box(200, 822, 920, 868));
    expect(referenceRect(plus, null, 'top')).toEqual(plus);
  });

  it('a window stops at fixed chrome floating over it', () => {
    const wall = box(18, 316, 1411, 906);
    const dock = box(360, 760, 1080, 882);
    const bar = box(0, 0, 1440, 52);
    expect(trimBy(wall, [dock])).toEqual(box(18, 316, 1411, 760));
    expect(trimBy(box(18, 20, 1411, 600), [bar])).toEqual(box(18, 52, 1411, 600));
    expect(trimBy(wall, [box(0, 0, 10, 10)])).toEqual(wall);
    expect(trimBy(box(0, 800, 100, 820), [box(0, 790, 100, 830)])).toBeNull();
  });

  it('the mask cuts one rounded window, sized once and moved by position', () => {
    const m = windowMask(box(18.2, 138, 1421, 216.4), 20);
    expect(m.image.startsWith('linear-gradient(#000 0 0), url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(m.image)).toContain("width='1403' height='78.5'");
    expect(decodeURIComponent(m.image)).toContain("rx='20'");
    expect(m.size).toBe('100% 100%, 1403px 78.5px');
    expect(m.position).toBe('0 0, 18px 138px');
    expect(decodeURIComponent(windowMask(box(0, 0, 30, 10), 40).image)).toContain("rx='5'");
  });

  it('the catch panels surround the window and never cover it', () => {
    const hole = box(100, 200, 300, 260);
    const parts = panels(hole, 1440, 900);
    expect(parts).toHaveLength(4);
    for (const p of parts) expect(intersects(p, hole)).toBe(false);
    expect(panels(box(-10, -10, 1450, 910), 1440, 900)).toEqual([]);
  });

  it('small helpers', () => {
    expect(union(box(0, 0, 10, 10), box(5, 5, 20, 30))).toEqual(box(0, 0, 20, 30));
    expect(pad(box(10, 10, 20, 20), 6)).toEqual(box(4, 4, 26, 26));
    expect(intersects(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(false);
    expect(opposite('top')).toBe('bottom');
    expect(opposite('left')).toBe('right');
  });

  it('a ring follows the control, not a 4px box around a wrapper with no corners', () => {
    expect(ringRadius(22)).toBe(26);
    expect(ringRadius(0, 999)).toBe(1003);
    expect(ringRadius(0, 0)).toBe(14);
    expect(ringRadius(2, 0)).toBe(14);
    // a conversation turn is a block of text that holds chips, not a wrapper
    expect(ringRadius(0, 999, 4, 14, 120, 36)).toBe(14);
    expect(ringRadius(0, 999, 4, 14, 40, 36)).toBe(1003);
    // two chips in a group are a cluster, not one pill
    expect(ringRadius(0, 999, 4, 14, 40, 36, 2)).toBe(14);
  });

  it('the curtain cuts every window with its own radius, in one mask the size of the screen', () => {
    const decode = (url: string) => decodeURIComponent(url.slice(url.indexOf(',') + 1, -2));
    const svg = decode(
      windowsMask(
        [
          { ...box(200, 240, 920, 750), radius: 25 },
          { ...box(200, 760, 920, 882), radius: 25 },
        ],
        1440,
        900,
      ),
    );
    expect(svg).toContain("width='1440' height='900'");
    expect(svg.match(/<rect x=/g)).toHaveLength(2);
    expect(svg).toContain("rx='25'");
    // a radius never exceeds half the window's short side
    expect(decode(windowsMask([{ ...box(0, 0, 20, 10), radius: 99 }], 100, 100))).toContain("rx='5'");
  });

  it("the rim traces each window and hides the part of one window's edge that lies inside another", () => {
    const svg = decodeURIComponent(
      windowsRim(
        [
          { ...box(0, 0, 100, 50), radius: 8 },
          { ...box(0, 48, 100, 120), radius: 8 },
        ],
        200,
        200,
        'rgba(255,255,255,0.16)',
      ),
    );
    expect(svg.match(/stroke='rgba\(255,255,255,0.16\)'/g)).toHaveLength(2);
    expect(svg).toContain("mask='url(#o)'");
  });

  it('a card goes beside its target on the right, then the left, and says when neither has room', () => {
    const need = 280 + 17 + 12;
    expect(sideWithRoom(box(200, 240, 920, 750), 1440, need)).toBe('right');
    expect(sideWithRoom(box(700, 240, 1420, 750), 1440, need)).toBe('left');
    expect(sideWithRoom(box(15, 140, 375, 640), 390, need)).toBeNull();
  });
});
