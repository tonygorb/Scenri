import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The brand menu with a real library behind it.
 *
 * At twenty-one brands the panel used to be as tall as the screen, a wall of
 * logos with Settings and the way out pushed to its bottom edge. It is now one
 * list, the brand you are in and then every other A to Z, and past six brands it
 * scrolls in place at a fixed height, so the claims worth pinning are about
 * order and about height: what comes first, what is all there, and that adding
 * brands never makes the panel taller.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const NAMES = ['Vela', 'Castro', 'Aer', 'Olivar', 'Bucherer', 'Nocturne', 'Halde', 'Glenmoor', 'Ilvaire', 'Maison Lou'];

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

async function home(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

/** Brands made through the API, returned by display name so a test can visit one. */
async function addBrands(p: Page, names: string[]): Promise<Map<string, string>> {
  for (const name of names) {
    await api(p, '/api/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand: { specVersion: '0.1', meta: { name } } }),
    });
  }
  const all = (await api(p, '/api/brands')) as { slug: string; json: { meta?: { name?: string } } }[];
  return new Map(all.map((b) => [b.json?.meta?.name ?? b.slug, b.slug]));
}

const panel = (p: Page) => p.locator('.sc-menu');
const scroller = (p: Page) => p.locator('.sc-menu-brands');
const namesIn = (p: Page) => scroller(p).locator('.sc-menu-brand-lb > span:first-child').allTextContents();

async function openMenu(p: Page) {
  await p.locator('.sc-org-btn').click();
  await expect(panel(p)).toBeVisible();
  // the panel arrives with a scale; measure it once it has landed
  await panel(p).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
}

test('a long list is one list: the brand you are in, then every other A to Z, at one height', async ({ page }) => {
  const own = await home(page);
  await addBrands(page, NAMES);
  // Brands opened in between change nothing about the order: there is no
  // section of recent ones, only the brand you are in and then the alphabet.
  await page.goto(`/${own}`);
  await openMenu(page);

  // No labels, no sections, no line inside the list.
  await expect(scroller(page).locator('.sc-menu-label')).toHaveCount(0);
  await expect(scroller(page).locator('.sc-menu-rule')).toHaveCount(0);
  const names = await namesIn(page);
  expect(names).toEqual([
    'E2E Fixture',
    'Aer',
    'Bucherer',
    'Castro',
    'Glenmoor',
    'Halde',
    'Ilvaire',
    'Maison Lou',
    'Nocturne',
    'Olivar',
    'Vela',
  ]);
  await expect(scroller(page).locator('.sc-menu-item').first()).toHaveAttribute('data-current', 'true');
  await expect(scroller(page).locator('.sc-menu-item[data-current] .sc-menu-check')).toHaveCount(1);
  // no fade laid over the rows
  expect(await scroller(page).evaluate((el) => getComputedStyle(el).maskImage)).toBe('none');

  // A compact list: rows you scan, not pictures you read.
  const rowH = await scroller(page)
    .locator('.sc-menu-item')
    .nth(1)
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(rowH).toBe(36);

  // The list scrolls inside itself; the panel does not, and the way out is on
  // screen without reaching for it.
  const fit = await scroller(page).evaluate((el) => ({ h: el.clientHeight, s: el.scrollHeight }));
  expect(fit.h).toBeLessThanOrEqual(36 * 10 + 1);
  expect(fit.s).toBeGreaterThan(fit.h);
  // and runs straight into the hairline under it, with no empty band between
  const band = await scroller(page).evaluate(
    (el) => (el.nextElementSibling as HTMLElement).getBoundingClientRect().top - el.getBoundingClientRect().bottom,
  );
  expect(Math.abs(band)).toBeLessThan(0.5);
  const tall = await panel(page).evaluate((el) => ({
    h: el.getBoundingClientRect().height,
    s: el.scrollHeight,
    c: el.clientHeight,
  }));
  expect(tall.s).toBeLessThanOrEqual(tall.c + 1);
  await expect(page.locator('.sc-menu-item[data-quit]')).toBeInViewport();
  await page.keyboard.press('Escape');

  // As many brands again, and the panel is exactly as tall as it was.
  await addBrands(
    page,
    NAMES.map((n) => `${n} Studio`),
  );
  await page.reload();
  await openMenu(page);
  const again = await panel(page).evaluate((el) => el.getBoundingClientRect().height);
  expect(Math.abs(again - tall.h)).toBeLessThan(1);
});

test('a query searches every brand, and Enter opens the first one you are not in', async ({ page }) => {
  const own = await home(page);
  const slugs = await addBrands(page, []);
  await page.goto(`/${own}`);
  await openMenu(page);

  const finder = page.getByRole('searchbox', { name: 'Find a brand' });
  await finder.fill('noc');
  // A query's hits, A to Z, across the library.
  await expect(scroller(page).locator('> .sc-menu-label')).toHaveCount(0);
  expect(await namesIn(page)).toEqual(['Nocturne', 'Nocturne Studio']);

  await finder.fill('zzz');
  await expect(page.locator('.sc-menu-none')).toHaveText('No brand by that name.');

  await finder.fill('noc');
  await finder.press('Enter');
  await page.waitForURL(`**/${slugs.get('Nocturne')}`);
});

test('a bar menu answers the next click at once, and one click moves to another menu', async ({ page }) => {
  await home(page);
  await page.waitForLoadState('networkidle');
  const at = async (sel: string) => {
    const b = (await page.locator(sel).boundingBox())!;
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] as const;
  };
  const brands = page.locator('.sc-menu[data-state="open"]', { hasText: 'Brands' });
  const [x, y] = await at('.sc-org-btn');

  // Closed and opened again inside the closing animation: the second click
  // used to land on a page the closing menu still held, and did nothing.
  await page.mouse.click(x, y);
  await expect(brands).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  await page.mouse.click(x, y);
  await expect(brands).toBeVisible();

  // With one panel open, one click on another control in the bar is that
  // control's panel, and it is still open once the first has finished closing.
  // The closing menu used to hand focus back to its own button on the way out,
  // which the new panel read as focus leaving it: it opened and shut at once.
  const start = page.locator('.sc-menu[data-state="open"]', { hasText: 'Add to this brand' });
  const activity = page.locator('.sc-notif-pop[data-state="open"]');
  const settled = async () => {
    await page.waitForFunction(() => document.querySelectorAll('.sc-menu, .sc-notif-pop').length === 1);
    // nothing to wait for when nothing happens: give a stray focus a moment to land
    await page.waitForTimeout(300);
  };
  const [nx, ny] = await at('.sc-new-more');
  const [ax, ay] = await at('.sc-act-btn');

  await page.mouse.click(nx, ny);
  await settled();
  await expect(start).toBeVisible();
  await expect(brands).toHaveCount(0);

  await page.mouse.click(x, y);
  await settled();
  await expect(brands).toBeVisible();
  await expect(start).toHaveCount(0);

  await page.mouse.click(ax, ay);
  await settled();
  await expect(activity).toBeVisible();
  await expect(brands).toHaveCount(0);

  await page.mouse.click(nx, ny);
  await settled();
  await expect(start).toBeVisible();
  await expect(activity).toHaveCount(0);
});

/**
 * A logo drawn in the page at a given size and uploaded to the kit under a role.
 * `full` is solid edge to edge, `rounded` is an app icon whose corners are clear,
 * `inset` is a mark on transparency.
 */
async function addLogo(
  p: Page,
  brandId: string,
  role: string,
  w: number,
  h: number,
  fill: string,
  shape: 'full' | 'rounded' | 'inset' = 'full',
) {
  await p.evaluate(
    async ([id, r, width, height, colour, form]) => {
      const c = document.createElement('canvas');
      c.width = width as number;
      c.height = height as number;
      const g = c.getContext('2d')!;
      g.fillStyle = colour as string;
      if (form === 'inset') g.fillRect(c.width / 4, c.height / 4, c.width / 2, c.height / 2);
      else if (form === 'rounded') {
        g.beginPath();
        g.roundRect(0, 0, c.width, c.height, c.width * 0.22);
        g.fill();
      } else g.fillRect(0, 0, c.width, c.height);
      const blob: Blob = await new Promise((done) => c.toBlob((b) => done(b!), 'image/png'));
      const fd = new FormData();
      fd.append('role', r as string);
      fd.append('file', new File([blob], 'logo.png', { type: 'image/png' }));
      const res = await fetch(`/api/brands/${id}/logos`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`logo upload ${res.status}`);
    },
    [brandId, role, w, h, fill, shape] as const,
  );
}

test('a circle draws a logo it can hold, and the initial for one it cannot', async ({ page }) => {
  await home(page);
  const slugs = await addBrands(page, [
    'Wide Wordmark',
    'Square Logo',
    'Has An Icon',
    'Declared Wordmark',
    'Rounded Icon',
    'Clear Logo',
  ]);
  const all = (await api(page, '/api/brands')) as { id: string; slug: string }[];
  const id = (name: string) => all.find((b) => b.slug === slugs.get(name))!.id;
  await addLogo(page, id('Wide Wordmark'), 'primary', 400, 80, '#1f6feb');
  await addLogo(page, id('Square Logo'), 'primary', 200, 200, '#1f6feb');
  await addLogo(page, id('Has An Icon'), 'primary', 400, 80, '#1f6feb');
  await addLogo(page, id('Has An Icon'), 'mark', 128, 128, '#e5534b');
  await addLogo(page, id('Declared Wordmark'), 'wordmark', 400, 80, '#1f6feb');
  await addLogo(page, id('Rounded Icon'), 'mark', 128, 128, '#111111', 'rounded');
  await addLogo(page, id('Clear Logo'), 'primary', 200, 200, '#1f6feb', 'inset');

  await page.reload();
  await openMenu(page);
  const avatar = (name: string) =>
    scroller(page)
      .locator('.sc-menu-item')
      .filter({ has: page.locator('.sc-menu-brand-lb > span:first-child', { hasText: new RegExp(`^${name}$`) }) })
      .last()
      .locator('.sc-brand-av');
  // a picture, shown, on the white plate
  const drawn = (name: string) => avatar(name).locator('img:not([hidden])');

  await expect(drawn('Square Logo')).toHaveCount(1);
  await expect(drawn('Has An Icon')).toHaveCount(1);
  // the stored icon, not the wide logo beside it: what is drawn is square
  const icon = drawn('Has An Icon');
  await expect.poll(() => icon.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  expect(await icon.evaluate((i: HTMLImageElement) => i.naturalWidth === i.naturalHeight)).toBe(true);
  // the wordmark is measured, found too wide, and the initial takes its place
  await expect(drawn('Wide Wordmark')).toHaveCount(0);
  await expect(avatar('Wide Wordmark')).toHaveText('W');
  await expect(drawn('Declared Wordmark')).toHaveCount(0);
  await expect(avatar('Declared Wordmark')).toHaveText('D');

  // An icon that is its own ground fills the circle, rounded corners and all;
  // a mark on transparency keeps the white plate behind it. Drawn the other
  // way, a solid square sat inside a white ring.
  await expect(avatar('Has An Icon')).toHaveAttribute('data-bleed', '');
  await expect(avatar('Rounded Icon')).toHaveAttribute('data-bleed', '');
  await expect(avatar('Square Logo')).toHaveAttribute('data-bleed', '');
  await expect(drawn('Clear Logo')).toHaveCount(1);
  await expect(avatar('Clear Logo')).not.toHaveAttribute('data-bleed');
  expect(await drawn('Rounded Icon').evaluate((i) => getComputedStyle(i).objectFit)).toBe('cover');
});
