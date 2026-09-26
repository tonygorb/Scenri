import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';
import { settle } from '../visual/shared.js';

/** Pictures for What's New: the real studio, framed at 16:10, checked for anything private. */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('../src/assets/whatsnew/', import.meta.url));
const NAME = /^\d+\.\d+\.\d+-[a-z0-9]+(-[a-z0-9]+)*$/;
const FAKE_IP = '192.168.1.20';
const LEAKS = [
  /E2E/,
  /fixture/i,
  /sc-e2e/,
  /\/Users\//,
  /\/home\//,
  /\/var\/folders\//,
  /\/tmp\//,
  /\b[A-Za-z]:\\/,
  /localhost/i,
  /127\.0\.0\.1/,
  /tonygorb/i,
  /\bDemo\b/,
  /reference shot/i,
  /\bsk-[\w-]{6,}/,
  /\br8_\w{6,}/,
];

type Rect = { x: number; y: number; width: number; height: number };
type Align = 'start' | 'center' | 'end';

/** Grow a box by `pad`, then to exactly 16:10 (width a multiple of 8), kept inside the viewport. */
export function frame(
  box: Rect,
  view: { width: number; height: number },
  pad = 24,
  align: Align | [Align, Align] = 'center',
): Rect {
  const [ax, ay] = (Array.isArray(align) ? align : [align, align]).map((a) => ({ start: 0, center: 0.5, end: 1 })[a]);
  const bw = box.width + pad * 2;
  const bh = box.height + pad * 2;
  const most = Math.floor(Math.min(view.width, view.height * 1.6) / 8) * 8;
  const width = Math.min(Math.ceil(Math.max(bw, bh * 1.6) / 8) * 8, most);
  const height = (width * 5) / 8;
  const place = (lo: number, size: number, want: number, k: number, room: number) =>
    Math.round(Math.min(Math.max(lo - (want - size) * k, 0), room - want));
  return {
    x: place(box.x - pad, bw, width, ax, view.width),
    y: place(box.y - pad, bh, height, ay, view.height),
    width,
    height,
  };
}

async function assertClean(page: Page, allow: string[]): Promise<void> {
  let text = await page.evaluate(() =>
    [
      document.body.innerText,
      ...Array.from(document.querySelectorAll('input, textarea'), (el) => (el as HTMLInputElement).value),
    ].join('\n'),
  );
  for (const a of allow) text = text.split(a).join('');
  const leaks = LEAKS.filter((re) => re.test(text)).map(String);
  const ips = (text.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []).filter((ip) => ip !== FAKE_IP);
  expect([...leaks, ...ips], 'private or test content on the page').toEqual([]);
}

export type ShootOptions = {
  pad?: number;
  align?: Align | [Align, Align];
  /** Hover this for an action state; otherwise the mouse is parked at `park` and focus is dropped. */
  hover?: Locator;
  park?: { x: number; y: number };
  /** Strings this shot may show that the leak scan would otherwise refuse. */
  allow?: string[];
};

/** Frame `target`, check the page, and write `src/assets/whatsnew/<name>.webp` at 1280x800 under 150 KiB. */
export async function shoot(
  page: Page,
  name: string,
  target: 'viewport' | Locator | Locator[] | Rect,
  opts: ShootOptions = {},
): Promise<void> {
  if (!NAME.test(name)) throw new Error(`${name}: not <version>-<words>`);
  const view = page.viewportSize() ?? { width: 1440, height: 900 };
  await settle(page);
  if (opts.hover) await opts.hover.hover();
  else {
    await page.mouse.move(opts.park?.x ?? 1, opts.park?.y ?? view.height - 1);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  await page.waitForTimeout(250);
  await assertClean(page, opts.allow ?? []);

  let box: Rect = { x: 0, y: 0, ...view };
  if (Array.isArray(target) || (typeof target === 'object' && 'boundingBox' in target)) {
    const boxes = await Promise.all((Array.isArray(target) ? target : [target]).map((l) => l.boundingBox()));
    const all = boxes.filter((b): b is Rect => !!b);
    if (all.length === 0) throw new Error(`${name}: nothing to frame`);
    const x = Math.min(...all.map((b) => b.x));
    const y = Math.min(...all.map((b) => b.y));
    box = {
      x,
      y,
      width: Math.max(...all.map((b) => b.x + b.width)) - x,
      height: Math.max(...all.map((b) => b.y + b.height)) - y,
    };
  } else if (typeof target === 'object') box = target;
  const clip = target === 'viewport' ? box : frame(box, view, opts.pad, opts.align);
  if (clip.width < 512) throw new Error(`${name}: a ${clip.width}px crop is too small to read`);

  const png = await page.screenshot({ clip, caret: 'hide' });
  for (const quality of [80, 74, 68]) {
    const webp = await sharp(png).resize(1280, 800, { fit: 'fill' }).webp({ quality }).toBuffer();
    if (webp.length >= 150 * 1024) continue;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `${name}.webp`), webp);
    console.log(
      `${name}.webp 1280x800 ${(webp.length / 1024).toFixed(1)} KB q${quality} (clip ${clip.width}x${clip.height} at ${clip.x},${clip.y})`,
    );
    return;
  }
  throw new Error(`${name}: over 150 KiB at quality 68, crop tighter`);
}

/** A git-tracked `templates/previews/**.jpg` into the library; its hash. Nothing else may be uploaded. */
export async function upload(request: APIRequestContext, repoPath: string): Promise<string> {
  if (!/^templates\/previews\/[\w/-]+\.jpg$/.test(repoPath)) throw new Error(`${repoPath}: not a catalog preview`);
  execFileSync('git', ['ls-files', '--error-unmatch', repoPath], { cwd: ROOT, stdio: 'ignore' });
  const buffer = readFileSync(join(ROOT, repoPath));
  const res = await request.post('/api/images', {
    multipart: { file: { name: basename(repoPath), mimeType: 'image/jpeg', buffer } },
  });
  expect(res.ok(), `upload ${repoPath}`).toBe(true);
  return ((await res.json()) as { hash: string }).hash;
}

export async function seedBrand(request: APIRequestContext, name: string): Promise<{ id: string; slug: string }> {
  const res = await request.post('/api/brands', { data: { brand: { specVersion: '0.1', meta: { name } } } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id: string; slug: string };
}

/** A scene the brand owns, written from a catalog scene's own words and wearing its tracked picture. */
export async function seedScene(request: APIRequestContext, brandId: string, catalogId: string): Promise<string> {
  const s = JSON.parse(readFileSync(join(ROOT, 'templates', `${catalogId}.json`), 'utf8'));
  const previewHash = await upload(request, `templates/previews/${catalogId}.jpg`);
  const { name, prompt, lighting, description, subject, collections, verticals } = s;
  const res = await request.post(`/api/brands/${brandId}/scenes`, {
    data: { name, prompt, lighting, description, subject, collections, verticals, previewHash },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { scene: { id: string } }).scene.id;
}

/** Local access as a Mac on a home Wi-Fi shows it, with a made-up address and code and an iPhone just in. */
export async function stubLocalAccess(page: Page, at: number): Promise<void> {
  const address = `http://${FAKE_IP}:4747`;
  const phone = {
    reach: 'network',
    thisComputer: true,
    platform: 'darwin',
    address,
    url: `${address}/?t=305918`,
    code: '305918',
    others: [],
    problem: null,
    lastVisit: { at, device: 'iPhone' },
  };
  await page.route(/\/api\/phone(\?.*)?$/, (r) => r.fulfill({ json: phone }));
  await page.route(/\/api\/phone\/help$/, (r) => r.fulfill({ json: { firewall: 'ok' } }));
  await page.route(/\/api\/desktop$/, (r) =>
    r.fulfill({
      json: { supported: true, platform: 'darwin', installed: true, path: null, declined: false, installKind: 'npm' },
    }),
  );
}
