import { expect, type Page } from '@playwright/test';

/**
 * Home's three chapters, read as geometry: the use-case wall with the row that
 * filters it, then the Presenters and Scenes shelves. Shared by the desktop
 * spec and the phone and tablet legs, so both hold the same rule.
 */
export interface Chapter {
  title: string | null;
  top: number;
  bottom: number;
  /** From the bottom of the heading row to the top of its own grid. */
  headToGrid: number | null;
  cols: number;
  radius: string | null;
  cards: number;
}

export const chapters = (p: Page) => p.locator('main.sc-main > section');

/** Waits until all three chapters hold real cards, no skeletons left. */
export async function settledChapters(p: Page) {
  await expect(chapters(p)).toHaveCount(3);
  await expect(p.locator('main.sc-main .sc-masonry[aria-hidden]')).toHaveCount(0);
}

export function readChapters(p: Page): Promise<Chapter[]> {
  return p.locator('main.sc-main').evaluate((main) =>
    [...main.querySelectorAll(':scope > section')].map((section) => {
      const head = section.querySelector('.sc-sec-head');
      const grid = section.querySelector('.sc-masonry');
      const card = grid?.querySelector('.sc-lookcard');
      const box = section.getBoundingClientRect();
      return {
        title: head?.querySelector('h2')?.textContent ?? null,
        top: box.top,
        bottom: box.bottom,
        headToGrid: head && grid ? grid.getBoundingClientRect().top - head.getBoundingClientRect().bottom : null,
        cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        radius: card ? getComputedStyle(card).borderRadius : null,
        cards: grid?.children.length ?? 0,
      };
    }),
  );
}

/** The rule every width keeps: one beat between chapters, the wall's grid all the way down. */
export function expectOneRhythm([wall, presenters, scenes]: Chapter[]) {
  expect([presenters.title, scenes.title]).toEqual(['Presenters', 'Scenes']);
  expect(Math.round(presenters.top - wall.bottom)).toBe(46);
  expect(Math.round(scenes.top - presenters.bottom)).toBe(46);
  for (const shelf of [presenters, scenes]) {
    expect(Math.round(shelf.headToGrid ?? -1)).toBe(14);
    expect(shelf.cols).toBe(wall.cols);
    expect(shelf.radius).toBe(wall.radius);
  }
}
