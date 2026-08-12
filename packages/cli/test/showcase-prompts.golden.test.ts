/**
 * The naming migration's safety net.
 *
 * Every homepage showcase recipe is compiled exactly the way the server
 * compiles it — real demo-product and presenter images resolved off disk,
 * real scenes, real brief tokens — and the resulting prompt is locked to a
 * committed fixture.
 *
 * The whole point of splitting `promptName` (what the model reads) from
 * `name` (what humans read) is that renaming the second must not move the
 * first. This test is what proves it: shorten every display name in the
 * catalog and these 97 prompts must come out byte-identical.
 *
 * Regenerate deliberately, never casually:
 *   UPDATE_SHOWCASE_GOLDEN=1 pnpm --filter @scenri/cli test showcase-prompts
 * A diff here means the text sent to the engine changed. That is either a
 * genuine art-direction change (regenerate, and expect different pixels) or
 * a bug in the identity/display split (fix the code, not the fixture).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, type Core, type EngineCapabilities } from '@scenri/core';
import { compileBrief, type Brief } from '../src/brief.js';
import { loadScenes, sceneResolver, defaultScenesDir } from '../src/scenes.js';
import { loadDemoProducts, brandJsonWithResolvedDemoProducts } from '../src/demoProducts.js';
import { loadPresenters, brandJsonWithResolvedPresenters } from '../src/presenters.js';
import { loadShowcase } from '../src/showcase.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'showcase-prompts.json');

/** Deliberately generous: a cap that drops attachments would hide prompt drift behind a warning. */
const caps: EngineCapabilities = {
  id: 'golden',
  displayName: 'Golden',
  localOnly: false,
  supportsEdit: true,
  supportsMask: false,
  maxReferenceImages: 16,
};

/**
 * Deliberately records the attachment's `role`/`id`/`essential` and NOT its
 * `label`. The label is a display string and is expected to change when a
 * catalog entry is renamed — locking it here would make this test fail for
 * exactly the reason the migration exists. What must never drift is which
 * image is attached, in which role, carrying which identity.
 */
interface Row {
  id: string;
  prompt: string;
  width: number;
  height: number;
  attachments: { role: string; id?: string; essential: boolean }[];
  warnings: string[];
}

let home: string;
let core: Core;
let rows: Row[];
/** Live-only: labels are not fixtured (they are free to change), but they must still resolve. */
let labels: string[];

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'scenri-showcase-golden-'));
  core = createCore(home);

  const templatesRoot = defaultScenesDir();
  const { scenes } = loadScenes(templatesRoot);
  const { demoProducts } = loadDemoProducts();
  const { presenters } = loadPresenters();
  const { showcase } = loadShowcase();
  const templateById = sceneResolver(scenes);

  // Resolve the WHOLE catalog once. The per-entry read-through would redo the
  // same sharp conversions 97 times over; compileBrief only ever looks up the
  // ids its own tokens name, so a brand carrying every product and presenter
  // compiles each recipe identically to the server's narrow resolution.
  const allTokens = [
    ...demoProducts.map((p) => ({ t: 'product', id: p.id })),
    ...presenters.map((p) => ({ t: 'character', id: p.id })),
  ];
  let brand: any = { meta: { name: 'Scenri' }, products: [], characters: [] };
  brand = await brandJsonWithResolvedDemoProducts(core, templatesRoot, demoProducts, brand, allTokens);
  brand = await brandJsonWithResolvedPresenters(core, templatesRoot, presenters, brand, allTokens);

  rows = [];
  labels = [];
  for (const entry of showcase) {
    const compiled = compileBrief(entry.brief as Brief, {
      brand,
      images: core.images,
      engineCaps: caps,
      templateById,
    });

    rows.push({
      id: entry.id,
      prompt: compiled.prompt,
      width: compiled.width,
      height: compiled.height,
      attachments: compiled.attachments.map((a) => ({
        role: a.role,
        ...(a.id ? { id: a.id } : {}),
        essential: !!a.essential,
      })),
      warnings: compiled.warnings,
    });
    labels.push(...compiled.attachments.map((a) => a.label));
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
}, 300_000);

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('showcase compiled prompts', () => {
  it('compiles every shipped showcase recipe', () => {
    expect(rows.length).toBe(97);
    for (const r of rows) expect(r.prompt.length).toBeGreaterThan(0);
  });

  it('matches the committed fixture byte for byte', () => {
    if (process.env.UPDATE_SHOWCASE_GOLDEN === '1' || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(rows, null, 2)}\n`);
      console.warn(`showcase prompt fixture written: ${FIXTURE}`);
      return;
    }
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    // Compare per-entry so a failure names the recipe that drifted rather
    // than dumping a 97-element diff.
    expect(rows.map((r) => r.id)).toEqual(expected.map((r: Row) => r.id));
    const byId = new Map<string, Row>(expected.map((r: Row) => [r.id, r]));
    for (const row of rows) {
      expect(row, `showcase recipe "${row.id}" drifted`).toEqual(byId.get(row.id));
    }
  });

  it('never attaches a reference with an empty label', () => {
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label.trim()).not.toBe('');
  });

  it('every product and character attachment carries its catalog id', () => {
    for (const r of rows) {
      for (const a of r.attachments) {
        if (a.role === 'product' || a.role === 'character') {
          expect(a.id, `${r.id} attachment missing id`).toBeTruthy();
        }
      }
    }
  });
});
