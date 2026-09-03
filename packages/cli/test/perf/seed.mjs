#!/usr/bin/env node
/**
 * Seed a performance fixture: one Scenri home per tier under ~/.scenri-perf.
 *
 *   pnpm perf:seed -- --tier small|medium|large|stress|all [--force] [--force-pool]
 *
 * Every row goes through the store's own methods so it is shaped exactly like
 * the app's writes. The only raw SQL is four UPDATEs that pin timestamps the
 * store stamps from the clock (nodes.created_at, brands, sets, set_nodes), so
 * two seeds of the same tier on the same day produce the same timeline.
 * Deterministic by construction (seeded PRNG), idempotent (a marker records
 * tier, fixture, schema and pool versions), never touches ~/.scenri.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { validateBrand } from '@scenri/brand';
import { openDb, SCHEMA_VERSION } from '../../../core/src/db.ts';
import { createStore } from '../../../core/src/store.ts';
import { createCatalogStore } from '../../../core/src/catalogStore.ts';
import { createLedger } from '../../../core/src/ledger.ts';
import { createImageStore } from '../../../core/src/imageStore.ts';
import { presenterCrops } from '../../src/customAssets.ts';
import { ensurePool, linkImage } from './lib/pool.mjs';
import { rng } from './lib/prng.mjs';
import * as prose from './lib/prose.mjs';
import { PERF_ROOT, parseArgs } from './lib/results.mjs';
import { ROOT } from './lib/server.mjs';
import {
  BIG_BRAND_PRODUCTS,
  FIXTURE_VERSION,
  POOL_VERSION,
  RATIOS,
  TIER_NAMES,
  TIERS,
  totalNodes,
} from './lib/tiers.mjs';

const args = parseArgs(process.argv.slice(2));
const tiers = args.tier === 'all' ? TIER_NAMES : [args.tier ?? 'small'];
for (const t of tiers) if (!TIERS[t]) throw new Error(`unknown tier ${t}; one of ${TIER_NAMES.join(', ')}`);

const perfRoot = resolve(PERF_ROOT);
if (perfRoot === resolve(homedir(), '.scenri') || perfRoot === ROOT || perfRoot.startsWith(`${ROOT}/`)) {
  throw new Error(`refusing to seed into ${perfRoot}`);
}
const log = (line) => console.log(line);

const FORMAT_OF = {
  '1024x1280': 'portrait',
  '1122x1402': 'portrait',
  '1024x1024': 'square',
  '1536x1024': 'landscape',
  '1080x1920': 'story',
};
const FORMAT_DIMS = { square: [1024, 1024], portrait: [1024, 1280], story: [1080, 1920], landscape: [1600, 900] };
const MIN = 60_000;
const DAY = 86_400_000;

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** The exact text addNodes writes: datetime('now') with milliseconds appended (store.ts:152-155). */
const stampMs = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
};
const stampSec = (ms) => stampMs(ms).slice(0, 19);
const slugOf = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function curated(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      return { id: j.id ?? basename(f, '.json'), name: j.name ?? j.id ?? basename(f, '.json') };
    });
}
const CURATED_SCENES = curated(join(ROOT, 'templates'));
const CURATED_PRESENTERS = curated(join(ROOT, 'templates', 'presenters'));

/** The events of one brand, oldest first: generation batches and the edit chains that hang off them. */
function timeline(r, quota, maxDepth, anchor) {
  const events = [];
  let count = 0;
  let t = anchor - 60 * MIN - Math.ceil(quota / 2.4) * 7.5 * MIN;
  while (count < quota) {
    const size = Math.min(
      r.weighted([
        [1, 55],
        [2, 25],
        [4, 20],
      ]),
      quota - count,
    );
    const gen = { t, count: size, chains: [] };
    count += size;
    let et = t;
    for (let slot = 0; slot < size && count < quota; slot++) {
      if (!r.chance(0.22)) continue;
      et += r.int(1, 5) * MIN;
      const chain = [et];
      count++;
      while (chain.length < maxDepth && count < quota && r.chance(0.35)) {
        et += r.int(1, 5) * MIN;
        chain.push(et);
        count++;
      }
      gen.chains.push({ slot, chain });
    }
    events.push(gen);
    t = et + r.int(3, 12) * MIN;
  }
  return { events, count };
}

function pickSize(r) {
  return r.weighted([
    [[1024, 1280], 45],
    [[1122, 1402], 20],
    [[1024, 1024], 20],
    [[1536, 1024], 10],
    [[1080, 1920], 5],
  ]);
}

/** Pool files by shape, so a product gets a square and a presenter a portrait. */
function byShape(pool) {
  const square = pool.files.filter((f) => f.w === f.h);
  const portrait = pool.files.filter((f) => f.h > f.w);
  const landscape = pool.files.filter((f) => f.w > f.h);
  return { square, portrait, landscape, any: pool.files };
}

function brandKit(r, shapes, sizes) {
  const products = Array.from({ length: sizes.products }, (_, i) => {
    const front = r.pick(shapes.square);
    const side = r.pick(shapes.square);
    return {
      id: `p-${r.hex(8)}`,
      name: i < prose.PRODUCT_NAMES.length ? prose.PRODUCT_NAMES[i] : `${r.pick(prose.PRODUCT_NAMES)} ${i}`,
      category: r.pick(prose.PRODUCT_CATEGORIES),
      shots: [
        { file: `asset:${front.hash}`, locked: true, angle: 'front' },
        { file: `asset:${side.hash}`, locked: true, angle: 'three-quarter' },
      ],
      ...(r.chance(0.4) ? { material: r.pick(['glass', 'linen', 'steel', 'ceramic']) } : {}),
    };
  });
  const characters = Array.from({ length: sizes.presenters }, (_, i) => {
    const frames = Array.from({ length: 4 }, () => r.pick(shapes.portrait).hash);
    const extra = r.pick(shapes.portrait).hash;
    const name = i < prose.PERSON_NAMES.length ? prose.PERSON_NAMES[i] : `${r.pick(prose.PERSON_NAMES)} ${i}`;
    const hair = r.pick(prose.HAIR);
    return {
      id: `up-${r.hex(8)}`,
      name,
      origin: 'custom',
      promptName: name,
      presentation: r.pick(['woman', 'man']),
      descriptor: `${r.pick(['Warm editorial', 'Cool minimal', 'Bright commercial'])} · ${hair} · composed`,
      ageRange: r.pick(prose.AGES),
      hair,
      identityNotes: `${hair}, ${r.pick(prose.AGES)}, the face must survive every generation`,
      negativeConstraints: ['no hair grown past the crop length', 'no change of eye colour'],
      suitableCategories: r.sample(prose.VERTICALS, 2),
      shots: ['front', 'left-profile', 'right-profile', 'back'].map((angle, k) => ({
        file: `asset:${frames[k]}`,
        angle,
        locked: true,
      })),
      sourceRefs: [{ file: `asset:${frames[0]}` }, { file: `asset:${extra}` }],
    };
  });
  const scenes = Array.from({ length: sizes.scenes }, (_, i) => {
    const name = i < prose.SCENE_NAMES.length ? prose.SCENE_NAMES[i] : `${r.pick(prose.SCENE_NAMES)} ${i}`;
    const ref = r.pick(shapes.portrait).hash;
    return {
      id: `us-${r.hex(8)}`,
      name,
      promptName: name,
      lighting: r.pick(['Even soft north light', 'Low warm lamplight', 'Hard noon sun', 'Diffused overcast daylight']),
      description: `${name}: a reusable set the brand shoots in.`,
      subject: 'either',
      collections: [r.pick(prose.COLLECTIONS)],
      verticals: r.sample(prose.VERTICALS, 2),
      keywords: [name.toLowerCase(), r.pick(prose.VERTICALS).toLowerCase()],
      prompt: prose.prompt(r, { target: 400 }),
      width: 1024,
      height: 1280,
      refs: [{ file: `asset:${ref}` }],
      preview: `asset:${ref}`,
    };
  });
  return { products, characters, scenes };
}

async function seedTier(tier, pool) {
  const spec = TIERS[tier];
  const home = join(perfRoot, tier);
  const markerPath = join(home, 'perf-fixture.json');
  const want = { tier, fixtureVersion: FIXTURE_VERSION, schemaVersion: SCHEMA_VERSION, poolVersion: POOL_VERSION };
  if (existsSync(markerPath) && !args.force) {
    const have = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (Object.keys(want).every((k) => have[k] === want[k])) {
      log(`${tier}: up to date (${have.counts.nodes} nodes, seeded ${have.generatedAt})`);
      return;
    }
  }
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const started = Date.now();
  const db = openDb(home);
  const store = createStore(db);
  const catalog = createCatalogStore(db);
  const images = createImageStore(home);
  const ledger = createLedger(db);
  const core = { home, store, catalog, images, ledger, close: () => db.close() };
  const seed = `scenri-perf:${tier}:v${FIXTURE_VERSION}`;
  const R = rng(seed);
  const now = new Date();
  const anchor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const shapes = byShape(pool);
  const link = (hash) => linkImage(pool.path(hash), images.pathFor(hash));
  const total = totalNodes(tier);
  const big = spec.brands[0];
  const counts = {
    brands: 0,
    nodes: 0,
    edits: 0,
    kept: 0,
    archived: 0,
    errors: 0,
    sets: 0,
    memberships: 0,
    catalogProducts: 0,
    presenters: 0,
    scenes: 0,
  };

  const setCreated = db.prepare('UPDATE nodes SET created_at=? WHERE id=?');
  const setBrandStamps = db.prepare('UPDATE brands SET created_at=?, updated_at=? WHERE id=?');
  const setSetStamps = db.prepare('UPDATE sets SET created_at=?, updated_at=? WHERE id=?');
  const setAdded = db.prepare('UPDATE set_nodes SET added_at=? WHERE set_id=? AND node_id=?');

  for (let b = 0; b < spec.brands.length; b++) {
    const quota = spec.brands[b];
    const r = R.fork(`brand:${b}`);
    const sizes = {
      products: b === 0 ? BIG_BRAND_PRODUCTS : Math.max(2, Math.round((BIG_BRAND_PRODUCTS * quota) / big)),
      presenters: b === 0 ? spec.presenters : quota >= 100 ? 1 : 0,
      scenes: b === 0 ? spec.scenes : quota >= 100 ? 1 : 0,
    };
    const kit = brandKit(r, shapes, sizes);
    for (const p of kit.products) for (const s of p.shots) link(s.file.slice(6));
    for (const c of kit.characters) {
      for (const s of c.shots) link(s.file.slice(6));
      for (const s of c.sourceRefs) link(s.file.slice(6));
    }
    for (const s of kit.scenes) link(s.preview.slice(6));
    // crops before the transaction: sharp is async, and boot recomputes exactly these
    for (const c of kit.characters) {
      const { previewHash, avatarHash } = await presenterCrops(core, c.shots[0].file.slice(6), 'upload');
      if (previewHash) c.preview = `asset:${previewHash}`;
      if (avatarHash) c.avatar = `asset:${avatarHash}`;
    }
    const name =
      b < prose.BRAND_NAMES.length
        ? prose.BRAND_NAMES[b]
        : `${prose.BRAND_NAMES[b % prose.BRAND_NAMES.length]} ${Math.floor(b / prose.BRAND_NAMES.length) + 1}`;
    const palette = r.pick(prose.PALETTES);
    const json = {
      specVersion: '0.1',
      meta: {
        name,
        tagline: 'Made for the shelf',
        industry: r.pick(prose.VERTICALS),
        website: `https://${slugOf(name)}.example`,
      },
      palette: {
        primary: { hex: palette.primary[0], name: palette.primary[1] },
        secondary: { hex: palette.secondary[0], name: palette.secondary[1] },
        accent: palette.accent.map(([hex, n]) => ({ hex, name: n })),
      },
      products: kit.products,
      characters: kit.characters,
      scenes: kit.scenes,
    };
    const verdict = validateBrand(json);
    if (verdict.valid === false || verdict.ok === false)
      throw new Error(`brand ${name} invalid: ${JSON.stringify(verdict.errors ?? verdict)}`);

    const { events, count: planned } = timeline(r.fork('timeline'), quota, spec.maxEditDepth, anchor);
    const catalogIds = [];
    const brandCreated = anchor - (b + 1) * 30 * DAY;

    db.transaction(() => {
      const brand = store.createBrand(json);
      setBrandStamps.run(stampSec(brandCreated), stampSec(brandCreated), brand.id);
      const project = store.workspaceFor(brand.id);
      const root = store.treeFor(project.id)[0];
      const sets = [];
      const setCount = quota >= 20 ? Math.max(1, Math.round((spec.sets * quota) / total)) : 0;
      for (let j = 0; j < setCount; j++) {
        const setName =
          j < prose.SET_NAMES.length
            ? prose.SET_NAMES[j]
            : `${prose.SET_NAMES[j % prose.SET_NAMES.length]} ${Math.floor(j / prose.SET_NAMES.length) + 1}`;
        const set = store.createSet(brand.id, setName);
        const at = stampSec(brandCreated + (j + 1) * 7 * DAY);
        setSetStamps.run(at, at, set.id);
        sets.push(set);
      }
      counts.sets += sets.length;

      if (spec.catalog && b === spec.catalog.brand) {
        const source = catalog.upsertSource(brand.id, `https://${slugOf(name)}.example`, 'shopify');
        let imagesTotal = 0;
        for (let i = 0; i < spec.catalog.products; i++) {
          const title = `${r.pick(prose.PRODUCT_NAMES)} ${r.pick(['classic', 'mini', 'pro', 'lite', 'XL'])} ${i}`;
          const handle = slugOf(title);
          const shots = Array.from({ length: r.int(2, 3) }, () => r.pick(shapes.square));
          for (const s of shots) link(s.hash);
          imagesTotal += shots.length;
          const row = catalog.upsertProduct({
            sourceId: source.id,
            brandId: brand.id,
            externalKey: String(1000 + i),
            title,
            descriptionHtml: `<p>${prose.prompt(r, { target: 160 })}</p>`,
            url: `https://${slugOf(name)}.example/products/${handle}`,
            handle,
            vendor: name,
            productType: r.pick(prose.PRODUCT_CATEGORIES),
            tags: r.sample(prose.PRODUCT_CATEGORIES, 2),
            price: r.int(12, 240),
            currency: 'USD',
            available: true,
            variants: Array.from({ length: r.int(2, 4) }, (_, k) => ({
              externalKey: `${1000 + i}-${k}`,
              title: `${r.pick(['Black', 'Sand', 'Olive'])} / ${r.pick(['S', 'M', 'L'])}`,
              sku: `SKU-${1000 + i}-${k}`,
              price: r.int(12, 240),
              options: { Color: r.pick(['Black', 'Sand', 'Olive']), Size: r.pick(['S', 'M', 'L']) },
            })),
            images: shots.map((s, k) => ({
              sourceUrl: `https://cdn.${slugOf(name)}.example/${i}-${k}.jpg`,
              assetRef: `asset:${s.hash}`,
              width: s.w,
              height: s.h,
              position: k,
              alt: title,
            })),
          });
          if (r.chance(0.3))
            catalog.updateProduct(row.id, {
              category: r.pick(prose.PRODUCT_CATEGORIES),
              material: 'cotton',
              dimensions: '20 x 30 cm',
            });
          catalogIds.push(`cat-${row.id}`);
        }
        catalog.setSourceStatus(source.id, 'completed', true);
        const job = catalog.createJob({
          brandId: brand.id,
          sourceId: source.id,
          url: `https://${slugOf(name)}.example`,
          platform: 'shopify',
        });
        catalog.updateJob(job.id, {
          stage: 'completed',
          discovered: spec.catalog.products,
          fetched: spec.catalog.products,
          upserted: spec.catalog.products,
          imagesDone: imagesTotal,
          imagesTotal,
          finished: true,
        });
        counts.catalogProducts += spec.catalog.products;
      }

      const productIds = [...kit.products.map((p) => p.id), ...catalogIds];
      const personIds = kit.characters.map((c) => c.id);
      const personNames = new Map(kit.characters.map((c) => [c.id, c.name]));
      const sceneIds = kit.scenes.map((s) => s.id);
      const sceneNames = new Map([
        ...kit.scenes.map((s) => [s.id, s.name]),
        ...CURATED_SCENES.map((s) => [s.id, s.name]),
      ]);
      for (const p of CURATED_PRESENTERS) personNames.set(p.id, p.name);
      const colors = [json.palette.primary, json.palette.secondary, ...json.palette.accent];
      const done = [];
      const createdAt = new Map();
      let k = 0;
      const poolFor = () => pool.files[(planned - 1 - k++) % pool.count];

      const makeBrief = (size, format, count, tokens, rendered) => ({
        tokens,
        templateFields: {},
        variants: count,
        quality: r.pick(['standard', 'high', 'draft']),
        format,
        ...(rendered ? { rendered: { sizes: [[size[0], size[1]]], requestedSize: FORMAT_DIMS[format] } } : {}),
      });
      const insertBatch = (parentId, kind, text, engineId, count, t) => {
        const nodes = store.addNodes({ projectId: project.id, parentId, kind, prompt: text, engineId, count });
        nodes.forEach((n, i) => {
          setCreated.run(stampMs(t - i), n.id);
          createdAt.set(n.id, t - i);
        });
        return nodes;
      };
      const finish = (node, brief, engineId, size, failed) => {
        store.setBrief(node.id, brief);
        if (failed) {
          store.failNode(node.id, r.pick(prose.FAILURES));
          counts.errors++;
          return null;
        }
        const file = poolFor();
        link(file.hash);
        const durationMs =
          engineId === 'codex-cli' ? r.int(25, 120) * 1000 : engineId === 'openrouter' ? r.int(8, 30) * 1000 : 1000;
        store.completeNode(node.id, { images: [file.hash], costUsd: 0, durationMs });
        const rec = { id: node.id, hash: file.hash, size, brief, t: createdAt.get(node.id) };
        done.push(rec);
        return rec;
      };

      for (const ev of events) {
        const engineId = r.weighted([
          ['codex-cli', 80],
          ['openrouter', 15],
          ['demo', 5],
        ]);
        const size = pickSize(r);
        const format = FORMAT_OF[`${size[0]}x${size[1]}`];
        const tokens = [];
        let sceneName;
        if (r.chance(0.7) && productIds.length) tokens.push({ t: 'product', id: r.pick(productIds) });
        if (r.chance(0.4))
          tokens.push({
            t: 'character',
            id: r.chance(0.6) && personIds.length ? r.pick(personIds) : r.pick(CURATED_PRESENTERS).id,
          });
        if (r.chance(0.6)) {
          const sceneId = r.chance(0.6) && sceneIds.length ? r.pick(sceneIds) : r.pick(CURATED_SCENES).id;
          tokens.push({ t: 'template', id: sceneId });
          sceneName = sceneNames.get(sceneId);
        }
        if (r.chance(0.3)) {
          const c = r.pick(colors);
          tokens.push({ t: 'color', hex: c.hex, name: c.name });
        }
        tokens.push({ t: 'format', id: format, w: FORMAT_DIMS[format][0], h: FORMAT_DIMS[format][1] });
        tokens.push({
          t: 'text',
          v: r.pick(['on a shelf, editorial', 'held in hand', 'mid pour', 'close and quiet', 'wide and airy']),
        });
        const text = prose.prompt(r, { sceneName });
        const nodes = insertBatch(root.id, 'generation', text, engineId, ev.count, ev.t);
        const bySlot = new Map();
        for (let i = 0; i < nodes.length; i++) {
          const failed = r.chance(RATIOS.error);
          const brief = makeBrief(size, format, ev.count, tokens, !failed && r.chance(RATIOS.rendered));
          if (sceneName && r.chance(0.2)) brief.templateId = tokens.find((x) => x.t === 'template')?.id;
          const rec = finish(nodes[i], brief, engineId, size, failed);
          if (rec) bySlot.set(i, rec);
        }
        counts.nodes += nodes.length;
        if (engineId === 'openrouter' && bySlot.size) {
          const cost = Math.round(r.float(0.03, 0.08) * 1000) / 1000;
          store.chargeNode(nodes[0].id, cost);
          ledger.recordCost(engineId, nodes[0].id, cost);
        }
        for (const { slot, chain } of ev.chains) {
          let parent = bySlot.get(slot);
          if (!parent) continue;
          for (const t of chain) {
            const instruction = prose.editInstruction(r);
            const [edit] = insertBatch(parent.id, 'edit', instruction, engineId, 1, t);
            const brief = {
              tokens: [{ t: 'text', v: instruction }],
              templateFields: {},
              variants: 1,
              quality: parent.brief.quality,
              format: parent.brief.format,
              sourceImage: parent.hash,
              inherited: parent.brief.tokens.filter((x) => x.t === 'product' || x.t === 'character'),
              ...(r.chance(RATIOS.rendered)
                ? {
                    rendered: {
                      sizes: [[parent.size[0], parent.size[1]]],
                      requestedSize: FORMAT_DIMS[parent.brief.format],
                    },
                  }
                : {}),
            };
            const rec = finish(edit, brief, engineId, parent.size, r.chance(RATIOS.error));
            counts.nodes++;
            counts.edits++;
            if (!rec) break;
            parent = rec;
          }
        }
      }

      const archived = r.sample(done, Math.round(done.length * RATIOS.archived));
      const archivedIds = new Set(archived.map((n) => n.id));
      for (const n of archived) store.setArchived(n.id, true);
      const kept = r.sample(
        done.filter((n) => !archivedIds.has(n.id)),
        Math.round(done.length * RATIOS.kept),
      );
      for (const n of kept) store.setKept(n.id, true);
      counts.archived += archived.length;
      counts.kept += kept.length;

      if (sets.length) {
        const per = Math.max(1, Math.round((spec.memberships * quota) / total / sets.length));
        for (const set of sets) {
          const members = r.sample(done, Math.min(per, done.length));
          store.addToSet(
            set.id,
            members.map((m) => m.id),
          );
          for (const m of members) setAdded.run(stampSec(m.t + MIN), set.id, m.id);
          counts.memberships += members.length;
        }
      }
      counts.brands++;
      counts.presenters += kit.characters.length;
      counts.scenes += kit.scenes.length;
    })();
    log(`${tier}: brand ${b + 1}/${spec.brands.length} ${name} (${quota} nodes)`);
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  const marker = {
    ...want,
    seed,
    anchor: new Date(anchor).toISOString(),
    counts,
    poolCount: pool.count,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
  writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  log(
    `${tier}: ${counts.nodes} nodes, ${counts.brands} brands, ${counts.sets} sets in ${Math.round(marker.durationMs / 1000)}s`,
  );
}

const poolCount = Math.min(1000, Math.max(...tiers.map(totalNodes), 1000));
const pool = await ensurePool(join(perfRoot, 'pool'), poolCount, 'scenri-perf-pool', {
  force: !!args['force-pool'],
  log,
});
for (const t of tiers) await seedTier(t, pool);
