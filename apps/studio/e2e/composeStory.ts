import type { APIRequestContext, Locator, Page, Response } from '@playwright/test';

/**
 * The compose story, walked the way a person walks it: open the brand, add a product and a scene
 * from the attach panel, say how in one line, generate, open the shot, and refine it once.
 *
 * One walk, two callers. compose-story.spec.ts walks it plainly on the demo engine, so a change to
 * any surface it crosses fails there first. A film capture outside the repo walks the same steps
 * with a director that paces them for a camera and marks the beats it cuts on. That caller loads
 * this file by path from a plain Node process, which is why it imports types and nothing else.
 */

/** What the story composes: public demo content only, nothing from anyone's library. */
export type Story = {
  /** The fictional brand the product is sold under, seeded by name. */
  brand: string;
  /** The product as its attach tile names it, and its catalog id (the chip's token). */
  product: string;
  productId: string;
  /** The scene as its attach tile names it, and its catalog id. */
  scene: string;
  sceneId: string;
  /** Everything typed after the two chips. It is the whole direction: nothing else is sent. */
  direction: string;
  /** The one refinement, typed on the open shot. */
  refinement: string;
};

/** The public recipe templates/showcase/barrier-cream-caddy.json, cut to one line a person would type. */
export const barrierCream: Story = {
  brand: 'Fenwick Slade',
  product: 'Barrier Cream',
  productId: 'fenwick-slade-barrier-cream',
  scene: 'Bath Caddy',
  sceneId: 'teak-bath-caddy',
  direction: ' Lid off, the jar centred on the caddy in hard sun.',
  refinement: 'Golden hour, long warm shadows',
};

/** The moments the story reaches, in order. A film cuts and frames on them; the spec checks the order. */
export type Beat =
  | 'home'
  | 'attach'
  | 'product'
  | 'scene'
  | 'chips'
  | 'direction'
  | 'generate'
  | 'rendering'
  | 'open'
  | 'landed'
  | 'refine'
  | 'refining'
  | 'refined';

/** How the walk is performed. The spec walks it plainly; a film paces it and moves a pointer. */
export type Director = {
  /** The story reached a beat. `subject` is what the moment is about, for a camera to frame. */
  beat(name: Beat, subject?: Locator): Promise<void>;
  click(target: Locator): Promise<void>;
  /** Type into a field, after whatever it already holds. */
  type(field: Locator, text: string): Promise<void>;
};

export const direct: Director = {
  beat: async () => {},
  click: (target) => target.click(),
  type: async (field, text) => {
    await field.click();
    await field.page().keyboard.press('End');
    await field.page().keyboard.type(text);
  },
};

/** The story's brand, created by name: the only brand a story's home should hold. */
export async function seedStoryBrand(request: APIRequestContext, story: Story): Promise<{ id: string; slug: string }> {
  const res = await request.post('/api/brands', {
    data: { brand: { specVersion: '0.1', meta: { name: story.brand } } },
  });
  if (!res.ok()) throw new Error(`seeding ${story.brand}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; slug: string };
}

/** One portrait picture a send, set before the studio first reads its settings, whatever the browser held. */
export async function storyPrefs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('scenri:count', '1');
    localStorage.setItem('scenri:format', JSON.stringify('portrait'));
  });
}

/**
 * Walk the story on the brand at `slug`, from Home to a refined shot on the stage. Every wait is on
 * the state the next step needs, never on time; `landMs` bounds the two waits on an engine, which
 * a real one needs minutes for.
 */
export async function composeStory(
  page: Page,
  story: Story,
  slug: string,
  d: Director = direct,
  landMs = 30_000,
): Promise<{ shotId: string; refinedId: string }> {
  const dock = page.locator('.sc-canvas-dock');
  const line = dock.locator('.sc-brief-line');

  // Home, where a brand starts: what Scenri makes, and the composer under it
  await page.goto(`/${slug}`);
  const heading = page.getByRole('heading', { name: /Compose a shot/ });
  await heading.waitFor();
  await line.waitFor();
  await d.beat('home', heading);

  // the catalog, one kind at a time: what, then where
  await d.click(dock.getByRole('button', { name: 'Add to shot', exact: true }));
  const panel = page.locator('.sc-attachpanel');
  await panel.waitFor();
  await d.beat('attach', panel);
  await pick(d, panel, 'Products', `Product: ${story.product}`);
  const productChip = line.locator(`[data-tok^="p:${story.productId}"]`);
  await productChip.waitFor();
  await d.beat('product', productChip);
  await pick(d, panel, 'Scenes', `Scene: ${story.scene}`);
  const sceneChip = line.locator(`[data-tok^="t:${story.sceneId}"]`);
  await sceneChip.waitFor();
  await d.beat('scene', sceneChip);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await d.beat('chips', line);

  // how, in one line
  await d.type(line, story.direction);
  await d.beat('direction', line);

  // Home starts the shot and moves to Create, where it renders; opened at once, it lands on the stage
  const sent = page.waitForResponse(postsNode);
  await d.click(dock.getByRole('button', { name: 'Generate', exact: true }));
  const shotId = firstId(await (await sent).json());
  await d.beat('generate');
  await page.waitForURL(new RegExp(`/${slug}/create(?:[?#]|$)`));
  const tile = page.locator(`.sc-feed .sc-cell[data-fb-node="${shotId}"]`);
  await tile.waitFor();
  await d.beat('rendering', tile);
  await d.click(tile.locator('.sc-cell-open'));
  await page.waitForURL(new RegExp(`/shots/${shotId}(?:[?#]|$)`));
  await page.locator('.sc-ovl-stage').waitFor();
  await d.beat('open', page.locator('.sc-ovl-stage'));
  await onStage(page, await finished(page, shotId, landMs));
  const stage = page.locator('.sc-ovl-stage .sc-stage-img');
  await d.beat('landed', stage);

  // one refinement, said in words; the stage moves onto the new step and it lands in place
  const edit = page.locator('.sc-ovl-edit');
  await d.type(edit.locator('.sc-brief-line'), story.refinement);
  await d.beat('refine', edit);
  const asked = page.waitForResponse(postsNode);
  await d.click(edit.getByRole('button', { name: 'Refine', exact: true }));
  const refinedId = ((await (await asked).json()) as { id: string }).id;
  await page.waitForURL(new RegExp(`/shots/${refinedId}(?:[?#]|$)`));
  await d.beat('refining', page.locator('.sc-ovl-stage'));
  await onStage(page, await finished(page, refinedId, landMs));
  await page.locator('.sc-ovl-head b', { hasText: 'Refinement 1' }).waitFor();
  await d.beat('refined', stage);
  return { shotId, refinedId };
}

/** Switch the panel to a kind's tab and add the one tile named, the way a person picks from it. */
async function pick(d: Director, panel: Locator, tab: string, name: string): Promise<void> {
  await d.click(panel.locator('.sc-ap-tabs button', { hasText: new RegExp(`^${literal(tab)}`) }));
  await d.click(panel.getByRole('button', { name: new RegExp(`^${literal(name)}\\b`) }));
}

const postsNode = (r: Response) => r.url().endsWith('/api/nodes') && r.request().method() === 'POST';

/**
 * Wait for the engine to finish a shot, and answer its picture's hash. A failed shot fails the walk
 * at once rather than at the end of `ms`, which for a real engine is minutes.
 */
async function finished(page: Page, id: string, ms: number): Promise<string> {
  const until = Date.now() + ms;
  for (;;) {
    const res = await page.request.get(`/api/nodes/${id}`);
    const node = (await res.json()) as { status?: string; images?: string[]; error?: string | null };
    if (node.status === 'done' && node.images?.[0]) return node.images[0];
    if (node.status === 'error') throw new Error(`shot ${id} failed: ${node.error ?? 'no reason given'}`);
    if (Date.now() > until) throw new Error(`shot ${id} is still ${node.status} after ${ms}ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * The stage showing the picture with this hash, decoded, and no render box left on it. By hash,
 * because an engine can hand back the same bytes as the parent: "the picture changed" is not the
 * signal, "this step's own picture is on the stage" is.
 */
async function onStage(page: Page, hash: string): Promise<void> {
  await page.waitForFunction(
    (h) => {
      const img = document.querySelector<HTMLImageElement>('.sc-ovl-stage .sc-stage-img');
      const settled = !document.querySelector('.sc-ovl-stage .sc-stage-wait');
      return !!img && settled && (img.getAttribute('src') ?? '').includes(h) && img.complete && img.naturalWidth > 0;
    },
    hash,
    { polling: 100 },
  );
}

/** A send answers with its batch; one picture a send makes the batch the shot itself. */
function firstId(body: unknown): string {
  const b = body as { id?: string; siblings?: { id: string }[] };
  const id = b.siblings?.[0]?.id ?? b.id;
  if (!id) throw new Error(`a send answered without a shot: ${JSON.stringify(body)}`);
  return id;
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
