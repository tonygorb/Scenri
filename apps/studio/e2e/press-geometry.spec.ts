import { test, expect, type Locator, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A press is paint, never movement.
 *
 * Every button, chip and icon button in the app used to drop a whole pixel on
 * `:active` (`transform: translateY(1px)` in styles/foundations/interaction.css),
 * the version thumbnails scaled to 0.985, and the asset picker translated half
 * a pixel over 220ms. Tiny, and the app read as a set of mechanical keys for it.
 *
 * Two guards, because they fail in different ways:
 *
 *  - the CSSOM sweep is total. It reads every rule the browser actually loaded
 *    and proves no `:active` rule on an `.sc-` selector touches a property that
 *    can move a box. A new component cannot reintroduce this without failing
 *    here, whether or not anyone thought to add it to the sample below.
 *  - the measured sweep is real. It holds the mouse down on live controls and
 *    compares the box, the border and the padding against rest, which is the
 *    only thing that proves the rules add up to a still interface.
 *
 * The press is released with the pointer moved away, so nothing is ever
 * clicked: this file measures controls, it does not operate them. That path is
 * also the one a user takes to cancel a press, so it is worth exercising.
 */

isolate();

/** Properties that can move, resize or reflow a control. None may appear in an `:active` rule. */
const GEOMETRY_PROPS = [
  'transform',
  'translate',
  'scale',
  'rotate',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'width',
  'height',
  'min-height',
  'min-width',
  'gap',
  'row-gap',
  'column-gap',
  'font-size',
];

/** The brand the app resolves "/" to, whatever this machine happens to hold. */
async function currentSlug(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

type Metrics = {
  x: number;
  y: number;
  w: number;
  h: number;
  border: string;
  padding: string;
  transform: string;
};

/**
 * How far a box may drift and still count as still.
 *
 * Not zero, because this app lays out on fractional offsets and the browser
 * re-snaps them by a few hundredths whenever anything nearby re-renders (the
 * same effect the visual config documents at its `animations: 'allow'` line).
 * Measured drift is around 0.03px. The smallest press offset this repo ever
 * shipped was 0.5px, so the threshold sits five times above the noise and five
 * times below the signal.
 */
const STILL_EPSILON = 0.1;

/**
 * Assert a held control is the same control. Numbers within the epsilon above,
 * box-model strings exactly equal: a border or padding swap is never subtle.
 */
function expectStill(held: Metrics, rest: Metrics, what: string): void {
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    expect(
      Math.abs(held[key] - rest[key]),
      `${what}: ${key} moved from ${rest[key]} to ${held[key]}`,
    ).toBeLessThanOrEqual(STILL_EPSILON);
  }
  expect(held.border, `${what}: border width changed`).toBe(rest.border);
  expect(held.padding, `${what}: padding changed`).toBe(rest.padding);
  expect(held.transform, `${what}: took a transform`).toBe(rest.transform);
}

/** The box and the box model, as the browser reports them right now. */
async function metrics(el: Locator): Promise<Metrics> {
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const cs = getComputedStyle(node);
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join(' '),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      transform: cs.transform,
    };
  });
}

/**
 * Hold the mouse down on a control and read it while it is held.
 *
 * The release happens with the pointer parked in the corner, so the control is
 * measured pressed but never activated. `--sc-dur-fast` is 120ms; the wait is
 * well past it so a press that eased in would still be caught at rest.
 */
async function pressAndMeasure(page: Page, el: Locator): Promise<{ rest: Metrics; held: Metrics }> {
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  expect(box, 'the control has no box to press').not.toBeNull();
  if (!box) throw new Error('unreachable');

  const rest = await metrics(el);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  const held = await metrics(el);
  await page.mouse.move(2, 2);
  await page.mouse.up();
  return { rest, held };
}

/**
 * Is the pointer actually able to reach this control?
 *
 * `:visible` only means it has a box. A topbar button behind an open settings
 * dialog is visible, occluded, and would report no hover and no press for a
 * reason that has nothing to do with the design system.
 */
async function reachable(el: Locator): Promise<boolean> {
  // elementFromPoint only answers for the viewport, so bring it in first
  await el.scrollIntoViewIfNeeded();
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit !== null && (hit === node || node.contains(hit));
  });
}

/**
 * Every visible, enabled, reachable control of these families on the current
 * surface, capped so one crowded page cannot dominate the run.
 */
async function controlsOn(page: Page, limitPerFamily = 4): Promise<{ label: string; el: Locator }[]> {
  const found: { label: string; el: Locator }[] = [];
  for (const family of ['.sc-btn', '.sc-chip', '.sc-icon-btn']) {
    const all = page.locator(`${family}:visible:not([disabled]):not([aria-disabled="true"])`);
    const total = await all.count();
    for (let i = 0; i < total && found.filter((f) => f.label.startsWith(family)).length < limitPerFamily; i++) {
      const el = all.nth(i);
      if (await reachable(el)) found.push({ label: `${family}#${i}`, el });
    }
  }
  return found;
}

test('no :active rule in the design system can move a box', async ({ page }) => {
  const slug = await currentSlug(page);
  await page.goto(`/${slug}`);

  const offenders = await page.evaluate((props) => {
    const bad: { selector: string; prop: string; value: string }[] = [];

    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        // media and supports blocks nest the rules that matter
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested) walk(nested);

        const style = (rule as CSSStyleRule).style;
        const selector = (rule as CSSStyleRule).selectorText;
        if (!style || !selector?.includes(':active')) continue;
        // the app's own vocabulary only: Radix ships a classic button variant
        // that genuinely depresses, and the app never uses that variant
        if (!selector.includes('.sc-')) continue;

        for (const prop of props) {
          const value = style.getPropertyValue(prop);
          if (value) bad.push({ selector, prop, value });
        }
      }
    };

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        // a cross-origin sheet cannot be read; the app ships none
      }
    }
    return bad;
  }, GEOMETRY_PROPS);

  expect(
    offenders,
    `pressed controls never change geometry, but these :active rules do:\n${offenders
      .map((o) => `  ${o.selector} { ${o.prop}: ${o.value} }`)
      .join('\n')}`,
  ).toEqual([]);
});

for (const surface of [
  { name: 'home', path: (s: string) => `/${s}` },
  { name: 'create', path: (s: string) => `/${s}/create` },
  { name: 'products library', path: (s: string) => `/${s}/products` },
  { name: 'settings: brand', path: (s: string) => `/${s}?settings=brand` },
  { name: 'settings: engines', path: (s: string) => `/${s}?settings=engines` },
  { name: 'settings: about', path: (s: string) => `/${s}?settings=about` },
]) {
  test(`pressed controls hold their geometry on ${surface.name}`, async ({ page }) => {
    const slug = await currentSlug(page);
    await page.goto(surface.path(slug));
    await page.waitForLoadState('networkidle');

    const controls = await controlsOn(page);
    expect(controls.length, `no controls found on ${surface.name} to press`).toBeGreaterThan(0);

    for (const { label, el } of controls) {
      const { rest, held } = await pressAndMeasure(page, el);
      expectStill(held, rest, `${surface.name} ${label} pressed`);
      expect(held.transform, `${surface.name} ${label} took a transform while pressed`).toBe('none');
    }
  });
}

/**
 * A press has to be visible, and the state it has to be visible against is
 * hover, not rest: with a mouse you are always hovering the thing you press.
 *
 * This is the guard the geometry pass needed. Removing `translateY(1px)` left
 * the topbar icon buttons with no feedback at all, because a scoped
 * `.sc-topbar .sc-icon-btn:hover` out-ranks the shared `.sc-icon-btn:active`
 * fill and simply held its hover tone through the press. Nothing about the
 * geometry assertions could have caught that.
 */
test('a pressed control does not look like a hovered one', async ({ page }) => {
  const slug = await currentSlug(page);
  const dead: string[] = [];

  for (const [surface, url] of [
    ['home', `/${slug}`],
    ['create', `/${slug}/create`],
    ['settings: brand', `/${slug}?settings=brand`],
  ] as const) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    for (const { label, el } of await controlsOn(page, 3)) {
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      if (!box) continue;
      const paint = () => el.evaluate((n) => `${getComputedStyle(n).backgroundColor} ${getComputedStyle(n).opacity}`);

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);
      const hovered = await paint();
      await page.mouse.down();
      await page.waitForTimeout(200);
      const held = await paint();
      await page.mouse.move(2, 2);
      await page.mouse.up();

      if (hovered === held) dead.push(`${surface} ${label}: hover and press are both ${held}`);
    }
  }

  expect(dead, `these controls give no feedback when pressed:\n  ${dead.join('\n  ')}`).toEqual([]);
});

test('a press that is dragged off and released leaves nothing behind', async ({ page }) => {
  const slug = await currentSlug(page);
  // The brand pane, not About: About's update row rewrites its own label while
  // it checks, and a control that relabels itself is not measuring a press.
  await page.goto(`/${slug}?settings=brand`);
  await expect(page.locator('.sc-set')).toBeVisible();
  await page.waitForLoadState('networkidle');

  const btn = page.locator('.sc-btn:visible').first();
  await expect(btn).toBeVisible();
  // Scroll first, then take the rest reading: pressAndMeasure scrolls too, and
  // a pane that moved under the control is not a control that moved.
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const before = await metrics(btn);

  // press, leave, release: the control must come back exactly as it was
  await pressAndMeasure(page, btn);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(200);
  expectStill(await metrics(btn), before, 'a released control');

  // and a rapid double press must not leave a stuck state either
  const box = await btn.boundingBox();
  if (!box) throw new Error('the button has no box');
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(2, 2);
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
  expectStill(await metrics(btn), before, 'a rapidly pressed control');
});
