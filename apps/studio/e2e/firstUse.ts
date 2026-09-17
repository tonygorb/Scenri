import { expect, type Page } from '@playwright/test';

/**
 * Shared steps for the first-use specs: a home that was new at its first boot,
 * a brand made the way a person makes it, the install's record read back, and
 * what a tour holds: a curtain over the page with a working window on the stop.
 */
export const tourTitle = (p: Page) => p.locator('.sc-tour .sc-tour-title');
export const tourCard = (p: Page) => p.locator('.sc-tour');
export const tourNext = (p: Page) => p.locator('.sc-tour .sc-tour-next');
export const tourBack = (p: Page) => p.locator('.sc-tour .sc-tour-back');
export const tourX = (p: Page) => p.getByRole('button', { name: 'Close tour' });
export const welcome = (p: Page) => p.locator('.sc-welcome');

export async function learned(p: Page): Promise<string[]> {
  return ((await (await p.request.get('/api/guide')).json()) as { learned: string[] }).learned;
}

/** The welcome waits for a quiet page; in a test the rest is zero. */
export async function noWelcomeWait(p: Page): Promise<void> {
  await p.addInitScript(() => window.localStorage.setItem('scenri:welcome-settle-ms', '0'));
}

export async function setUpBrand(p: Page, name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  await p.goto('/');
  await p.waitForURL((u) => u.pathname === '/setup');
  await p.getByRole('button', { name: 'Start from scratch instead' }).click();
  await p.locator('#sc-wiz-name').fill(name);
  await p.getByRole('button', { name: 'Create it' }).click();
  await p.waitForURL((u) => u.pathname === `/${slug}`);
  return slug;
}

/** A page's tour never starts: wait out a settle of the page, then look. */
export async function expectNoTour(p: Page): Promise<void> {
  await p.waitForTimeout(600);
  await expect(tourCard(p)).toHaveCount(0);
}

/**
 * The stop's window is open on the real control: a press at the centre of the
 * first visible match lands inside it, and the card neither covers it, nor
 * points anywhere else, nor leaves the screen. Measured against the page's own
 * boxes, never pixels.
 */
export async function pointsAt(p: Page, selector: string): Promise<void> {
  await expect(tourCard(p)).toHaveAttribute('data-state', 'shown');
  const r = await p.evaluate((sel) => {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0);
    const card = document.querySelector('.sc-tour');
    const arrow = document.querySelector<HTMLElement>('.sc-tour-arrow');
    if (!el || !card || !arrow) return null;
    const t = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = Math.min(Math.max(t.left + t.width / 2, 1), vw - 1);
    const cy = Math.min(Math.max(t.top + Math.min(t.height, vh - t.top) / 2, 1), vh - 1);
    const hit = document.elementFromPoint(Math.round(cx), Math.round(cy));
    const c = card.getBoundingClientRect();
    const a = arrow.getBoundingClientRect();
    const overlaps = c.left < t.right && t.left < c.right && c.top < t.bottom && t.top < c.bottom;
    const side = card.getAttribute('data-side');
    const across = side === 'top' || side === 'bottom';
    const mid = across ? a.left + a.width / 2 : a.top + a.height / 2;
    const span = across ? [t.left, t.right] : [t.top, t.bottom];
    return {
      inside: !!hit && el.contains(hit),
      overlaps,
      arrowOnTarget: arrow.hidden || (mid >= span[0] - 1 && mid <= span[1] + 1),
      onScreen: c.left >= 0 && c.top >= 0 && c.right <= vw && c.bottom <= vh,
    };
  }, selector);
  expect(r).toEqual({ inside: true, overlaps: false, arrowOnTarget: true, onScreen: true });
}

/** The page behind a tour is held: some of it is inert, and a press outside the window reaches the curtain. */
export async function expectHeld(p: Page): Promise<void> {
  await expect.poll(() => p.locator('[data-sc-tour-inert]').count()).toBeGreaterThan(0);
}

/** Nothing the tour held is left behind. */
export async function expectLetGo(p: Page): Promise<void> {
  await expect(p.locator('[data-sc-tour-inert]')).toHaveCount(0);
}
