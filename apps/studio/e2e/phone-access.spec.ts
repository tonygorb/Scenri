import { test, expect, type Browser, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Opening Scenri on a phone on the same Wi-Fi. This file's Scenri starts the
 * way a person's does, with SCENRI_HOST unset: 127.0.0.1 for this computer and
 * a listener on each of the machine's phone addresses beside it. The "phone"
 * is a fresh browser context that reaches the server through that address,
 * so every request it makes arrives on a real non-loopback socket, as a
 * phone's would, and is not a secure context, as a phone's is not.
 *
 * Skipped, and saying why, on a machine with no private network address.
 * CI's runners have one, and so does any laptop on Wi-Fi.
 */

// '' restores the default the harness pins away for every other file
isolate({ env: { SCENRI_HOST: '' } });

type Phone = { address: string | null; url: string | null; code: string; thisComputer: boolean };

let phone: Phone;
let slug: string;

test.beforeAll(async ({ request }) => {
  phone = await (await request.get('/api/phone')).json();
  const brands: { slug: string }[] = await (await request.get('/api/brands')).json();
  slug = brands[0].slug;
});

/** A browser that has never seen this Scenri: a phone picked up for the first time. */
async function device(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  return ctx.newPage();
}

test.describe
  .serial('open on your phone', () => {
    test.beforeEach(() => {
      test.skip(!phone.address, 'this machine has no private network address a phone could reach');
    });

    test('this computer: Phone and tablet shows the QR code, the typed way in, and copies the one link', async ({
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      // its own page in Settings, the code there as it opens
      await page.goto(`/${slug}?settings=general`);
      await page.getByRole('button', { name: 'Phone and tablet' }).click();
      await expect(page.getByText('Open on your phone', { exact: true })).toBeVisible();
      await expect(page.getByRole('img', { name: `QR code for ${phone.address}` })).toBeVisible();
      await expect(page.locator('.sc-phone-key')).toHaveText([phone.address ?? '', phone.code]);
      await expect(page.getByText('Waiting for your phone…')).toBeVisible();

      await page.getByRole('button', { name: 'Copy link' }).click();
      await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(phone.url);
    });

    test('a device that types the bare address is asked for the code, and gets in with it', async ({ browser }) => {
      const p = await device(browser);
      const bare = await p.goto(`${phone.address}/${slug}/create`);
      expect(bare?.status()).toBe(403);
      await expect(p.getByText('Enter the code shown in Scenri on your computer')).toBeVisible();

      await p.getByLabel('Code').fill('WRONG2');
      await p.getByRole('button', { name: 'Open' }).click();
      await expect(p.getByText('That code did not work')).toBeVisible();

      // typed the way people type it: lower case, with a space
      await p.getByLabel('Code').fill(`${phone.code.slice(0, 3)} ${phone.code.slice(3)}`.toLowerCase());
      await p.getByRole('button', { name: 'Open' }).click();
      await expect(p.getByText('Enter the code')).toHaveCount(0);
      expect(await p.evaluate(() => fetch('/api/brands').then((r) => r.status))).toBe(200);
      await p.context().close();
    });

    test('the link opens Scenri outright: the feed, its pictures, a new shot, over plain http', async ({ browser }) => {
      const p = await device(browser);
      await p.goto(phone.url ?? '');
      expect(await p.evaluate(() => window.isSecureContext)).toBe(false);

      await p.goto(`${phone.address}/${slug}/create`);
      const cell = p.locator('.sc-cell img').first();
      await expect(cell).toBeVisible();
      await expect
        .poll(() => cell.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
        .toBeGreaterThan(0);

      // make a shot from the phone, the demo engine standing in for a real one
      const made = await p.evaluate(async (brandSlug) => {
        const brands: { id: string; slug: string }[] = await (await fetch('/api/brands')).json();
        const brand = brands.find((b) => b.slug === brandSlug);
        const ws = await (await fetch(`/api/brands/${brand?.id}/workspace`)).json();
        const res = await fetch('/api/nodes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId: ws.project.id,
            kind: 'generation',
            engineId: 'demo',
            count: 1,
            prompt: 'made on the phone',
            width: 512,
            height: 512,
          }),
        });
        return { status: res.status, id: ((await res.json()) as { id: string }).id };
      }, slug);
      expect(made.status).toBe(202);
      await expect
        .poll(async () => p.evaluate((id) => fetch(`/api/nodes/${id}`).then((r) => r.json()), made.id), {
          timeout: 15_000,
        })
        .toMatchObject({ status: 'done' });
      const node = await p.evaluate((id) => fetch(`/api/nodes/${id}`).then((r) => r.json()), made.id);
      const picture = await p.evaluate(
        (hash) => fetch(`/api/images/${hash}`).then((r) => [r.status, r.headers.get('content-type')]),
        node.images[0],
      );
      expect(picture).toEqual([200, 'image/png']);
      await p.context().close();
    });

    test('a device is not this computer: no firewall reading, no waiting for itself', async ({ browser }) => {
      const p = await device(browser);
      await p.goto(phone.url ?? '');
      const seen = await p.evaluate(() => fetch('/api/phone').then((r) => r.json()));
      expect(seen.thisComputer).toBe(false);
      expect(await p.evaluate(() => fetch('/api/phone/help').then((r) => r.json()))).toEqual({ firewall: 'unknown' });

      await p.goto(`${phone.address}/${slug}?settings=phone`);
      await expect(p.getByRole('img', { name: `QR code for ${phone.address}` })).toBeVisible();
      await expect(p.getByText('Waiting for your phone')).toHaveCount(0);
      await expect(p.getByText('Not opening?')).toHaveCount(0);
      await p.context().close();
    });

    test('the API refuses a device without the code', async ({ browser }) => {
      const p = await device(browser);
      const res = await p.request.get(`${phone.address}/api/brands`);
      expect(res.status()).toBe(403);
      expect(await res.json()).toEqual({ error: 'access code required' });
      await p.context().close();
    });
  });
