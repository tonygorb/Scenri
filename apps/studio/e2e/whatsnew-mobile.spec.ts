import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * What's new at a hand's width. The dialog docks to the bottom edge as a sheet
 * rather than a shrunken desktop card, and the page folds its date column
 * above what each release says.
 *
 * Phones are held at 390px; the tablet project keeps its own viewport and
 * only runs what is not phone-only.
 */

isolate();

const PHONE = { width: 390, height: 844 };
const phone = (p: Page) => (p.viewportSize()?.width ?? 0) < 768;

test.beforeEach(async ({ page }, testInfo) => {
  // Every test here waits out the 2.5s auto-open settle; shorten it before boot.
  await page.addInitScript(() => localStorage.setItem('scenri:whatsnew-settle-ms', '300'));
  if (testInfo.project.name === 'mobile') await page.setViewportSize(PHONE);
});

const HOME = '/e2e-fixture';
const PAGE = '/e2e-fixture/whats-new';
const RELEASES_URL = 'https://github.com/tonygorb/scenri/releases';

const PIC_A = { file: '0.19.0-home-examples.webp', alt: "Home's example wall, with tabs above it." };
const PIC_B = { file: '0.19.0-use-this-view.webp', alt: "A scene's page, with Use this view on it." };

const HEADLINE = {
  version: '9.9.9',
  date: '2026-08-16',
  title: 'A new library of products, presenters and scenes',
  sections: [
    { heading: 'Library', body: 'The library holds more of everything.', image: PIC_A },
    { heading: 'Scenes', body: 'Any picture of a scene can be the frame a shot follows.', image: PIC_B },
  ],
};
const SMALL = {
  version: '9.9.8',
  date: '2026-08-12',
  sections: [{ heading: 'Fixes', body: 'Scene draws show in the bell as soon as they start.' }],
};
const OLDER = {
  version: '9.9.7',
  date: '2026-08-10',
  title: 'An older headline, told in words',
  sections: [{ heading: 'Create', body: 'Better picks.' }],
};

/**
 * The server's answer for [HEADLINE, SMALL, OLDER] running 9.9.9 (see
 * notesFor in whatsnew.spec.ts): read up to `seen`, everything newer unseen,
 * and the newest unread headline is the lead.
 */
function notes(seen: string) {
  const recent = [HEADLINE, SMALL, OLDER];
  const newer = (v: string) => v.localeCompare(seen, undefined, { numeric: true }) > 0;
  const unseen = recent.map((r) => r.version).filter(newer);
  return {
    version: '9.9.9',
    entry: HEADLINE,
    seen,
    recent,
    unseen,
    lead: recent.find((r) => 'title' in r && unseen.includes(r.version))?.version ?? null,
    changelogUrl: `${RELEASES_URL}/tag/v9.9.9`,
    releasesUrl: RELEASES_URL,
  };
}

/** Everything unread since 9.9.6; every acknowledgement is recorded, never written. */
async function serve(page: Page, seen = '9.9.6'): Promise<string[]> {
  const acked: string[] = [];
  let mark = seen;
  await page.route('**/api/release/notes', (route) => route.fulfill({ json: notes(mark) }));
  await page.route('**/api/release/seen', async (route) => {
    const v = String(route.request().postDataJSON()?.version);
    acked.push(v);
    mark = v;
    await route.fulfill({ json: { ok: true } });
  });
  return acked;
}

const sheet = (p: Page) => p.locator('.sc-wn');

test("What's new is a bottom sheet on a phone: the picture first, the foot in view, and it closes by hand", async ({
  page,
}) => {
  const acked = await serve(page);
  await page.goto(HOME);
  await expect(sheet(page)).toBeVisible({ timeout: 8000 });
  // measured once the sheet has stopped rising, not mid-travel
  await settledBox(page, '.sc-wn');

  // the picture leads the sheet, above when and the headline
  await expect(page.locator('.sc-wn .sc-newdlg-body > :first-child')).toHaveClass(/\bsc-wn-pic\b/);
  const img = page.locator('.sc-wn figure.sc-wn-pic > img');
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))
    .toBe(true);
  const pic = (await page.locator('.sc-wn figure.sc-wn-pic').boundingBox())!;
  const when = (await page.locator('.sc-wn .sc-wn-when').boundingBox())!;
  expect(pic.y + pic.height).toBeLessThanOrEqual(when.y + 0.5);
  await expect(page.locator('.sc-wn .sc-wn-hed')).toHaveText(HEADLINE.title);
  await expect(page.locator('.sc-wn a.sc-wn-link')).toHaveText('See 2 more updates');

  // the foot is on screen, whole: its link and Got it can be reached without scrolling
  await expect(page.locator('.sc-wn a.sc-wn-link')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.sc-wn .sc-wn-foot .sc-btn-primary')).toBeInViewport({ ratio: 1 });

  const box = (await sheet(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  if (phone(page)) {
    expect(viewport.width).toBe(PHONE.width);
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1);
    // the picture runs the sheet's content width, not a thumbnail in it
    const body = (await page.locator('.sc-wn .sc-newdlg-body').boundingBox())!;
    expect(pic.width).toBeGreaterThan(body.width * 0.8);
  } else {
    expect(box.width).toBeLessThan(viewport.width);
    expect(box.y).toBeGreaterThan(0);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.locator('.sc-wn .sc-btn-primary', { hasText: 'Got it' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => acked).toEqual(['9.9.9']);
});

async function settledBox(p: Page, sel: string) {
  let last = (await p.locator(sel).boundingBox())!;
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(50);
    const now = (await p.locator(sel).boundingBox())!;
    if (Math.abs(now.y - last.y) < 0.5) return now;
    last = now;
  }
  return last;
}

async function dragSheet(p: Page, grip: string, dy: number) {
  const box = await settledBox(p, grip);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x, y + dy, { steps: 10 });
  await p.waitForTimeout(200);
  await p.mouse.up();
}

test("What's new is dragged away, springs back from a nudge, and leaving that way reads it", async ({ page }) => {
  test.skip(!phone(page), 'the sheet only exists below 768px');
  const acked = await serve(page);
  await page.goto(HOME);
  await expect(sheet(page)).toBeVisible({ timeout: 8000 });

  const pull = (dy: number) => dragSheet(page, '.sc-wn > .sc-shotsheet-grip', dy);
  await pull(24);
  await expect(sheet(page)).toBeVisible();
  await expect.poll(() => sheet(page).evaluate((el) => el.style.transform)).toBe('');
  expect(acked).toEqual([]);

  await pull(200);
  await expect(sheet(page)).toHaveCount(0);
  await expect.poll(() => acked).toEqual(['9.9.9']);
});

test("the What's new page is one column on a phone, its pictures the column's width", async ({ page }) => {
  test.skip(!phone(page), 'the single column is the phone layout');
  await serve(page, '9.9.9');
  await page.goto(PAGE);
  const rows = page.locator('li.sc-wn-row');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('#sc-wn-title')).toBeFocused();

  // each release's when sits above what it says, on the same left edge
  for (let i = 0; i < 3; i++) {
    const row = rows.nth(i);
    const when = (await row.locator('.sc-wn-when').boundingBox())!;
    const first = row.locator('.sc-wn-what > :first-child');
    const what = (await first.boundingBox())!;
    expect(when.y + when.height, `row ${i + 1}: when is not above what it says`).toBeLessThanOrEqual(what.y + 0.5);
    expect(Math.abs(when.x - what.x), `row ${i + 1}: when and what do not share a left edge`).toBeLessThanOrEqual(1);
  }
  const lead = rows.nth(0);
  const whenBox = (await lead.locator('.sc-wn-when').boundingBox())!;
  const hedBox = (await lead.locator('h2.sc-wn-row-hed').boundingBox())!;
  expect(whenBox.y).toBeLessThan(hedBox.y);
  expect(Math.abs(whenBox.x - hedBox.x)).toBeLessThanOrEqual(1);

  // the lead's pictures run the full width of the column
  const column = (await lead.locator('.sc-wn-what').boundingBox())!;
  const figures = lead.locator('figure.sc-wn-pic');
  await expect(figures).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const f = (await figures.nth(i).boundingBox())!;
    expect(Math.abs(f.width - column.width), `picture ${i + 1} is not the column's width`).toBeLessThanOrEqual(1);
    expect(Math.abs(f.x - column.x)).toBeLessThanOrEqual(1);
  }

  // nothing runs off the side: not the document, not the pane that scrolls it
  const overflow = await page.evaluate(() => {
    const pane = document.querySelector('.sc-wn-page')?.parentElement;
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      pane: pane ? pane.scrollWidth - pane.clientWidth : 0,
      widest: Math.max(
        ...[...document.querySelectorAll('.sc-wn-page *')].map((el) => el.getBoundingClientRect().right),
      ),
    };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.pane).toBeLessThanOrEqual(0);
  expect(overflow.widest).toBeLessThanOrEqual(PHONE.width);
});
