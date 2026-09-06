import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadScenes, sceneResolver, defaultScenesDir } from './scenes.js';
import { brandJsonWithResolvedPresenters, loadPresenters } from './presenters.js';
import { brandJsonWithResolvedDemoProducts, loadDemoProducts, demoProductResolver } from './demoProducts.js';
import { compileBrief, validateBrief, FORMATS, type Attachment, type Brief, type BriefToken } from './brief.js';
import { mergeEditAttachments } from './attachmentBudget.js';
import { shotWordsFor } from './shotWords.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Core,
  EngineAdapter,
  EngineCapabilities,
  GenerateRequest,
  EditRequest,
  ReferenceRole,
  EngineResult,
} from '@scenri/core';
import { SpendCapError, ASPECT_TOLERANCE, BUDGET_EXHAUSTED, budgetSize, type OnImageLanded } from '@scenri/core';
import { readMeta } from './meta.js';
import { createUpdateChecker, type UpdateChecker } from './update/check.js';
import { createContentFetcher, type ContentFetcher } from './content/fetch.js';
import type { stageVersion } from './update/stage.js';
import { validateBrand, buildFromUrl, mergeScrape } from '@scenri/brand';
import type { EngineRegistry } from './engines.js';
import { brandJsonWithCatalogProducts, resolveLibraryProduct, runningImportCount } from './catalogImport.js';
import {
  brandCharacters,
  brandJsonWithIdentityCrops,
  brandSceneById,
  brandScenes,
  runningAssetBuildCount,
  type Analyzer,
} from './customAssets.js';
import type { CodexSetup } from '@scenri/engine-codex';
import { registerAccessGuard, type AccessOptions } from './access.js';
import { identityTokenKey, inheritedIdentityTokens } from './editIdentity.js';
import {
  characterEditIdentityDirective,
  characterFactDirectives,
  inheritedRefDirective,
  markEditDirective,
  personSkinDirective,
  productEditFidelityDirective,
  productFactDirectives,
  shotSpecifiesCamera,
} from './briefDirectives.js';
import { variationPlan } from './variationPlan.js';
import { scopeOfInstruction, type EditScope } from './editScopeRules.js';
import { gradeComposite, isGradeOnlyInstruction } from './gradeTransfer.js';
import {
  planExpand,
  expandInstruction,
  reframeInstruction,
  wantsImplicitReshape,
  type ExpandPlan,
} from './expandRules.js';
import { judgeEditSize, SAME_SHAPE_TOL } from './editSizeRules.js';
import { planCrop } from './cropRules.js';
import { classifyReshape, fitExpandToBudget } from './reshapeRules.js';
import { attentionCropOrigin } from './smartCrop.js';
import { expandCanvas, compositeExpand, reframeExpand } from './expand.js';
import { seamScore } from './seamScore.js';
import { seamPenalty, seamResidual } from './outpaint/score.js';
import { placeExpand, subjectFraction } from './outpaint/place.js';
import { conditioningCanvas } from './outpaint/conditioning.js';
import { chooseExpand, type ExpandDecision, type PreservedCandidate } from './outpaint/choose.js';
import { type OutpaintMethod, resolveOutpaintRoute } from './outpaint/route.js';
import { preserveOutsideChange } from './localEdit.js';
import {
  brandContext,
  capReferenceEdge,
  joinNames,
  PNG_SIG,
  readImagePart,
  toMarkPng,
  toPng,
} from './routes/shared.js';
import { registerLogoRoutes } from './routes/logos.js';
import { registerCatalogImportRoutes } from './routes/catalogImport.js';
import { registerSceneRoutes } from './routes/scenes.js';
import { registerPresenterRoutes } from './routes/presenters.js';
import { registerAssetBuildRoutes } from './routes/assetBuilds.js';
import { registerDemoProductRoutes } from './routes/demoProducts.js';
import { registerShowcaseRoutes } from './routes/showcase.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerCodexSetupRoutes } from './routes/codexSetup.js';
import { registerImageRoutes } from './routes/images.js';
import { createThumbStore } from './thumbs.js';
import { registerUpdateRoutes } from './routes/updates.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerDesktopRoutes } from './routes/desktop.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Abort in-flight generations, close the server, close the database. Idempotent. */
    drain(): Promise<void>;
    /** The update checker; serve.ts starts its periodic schedule after listen. */
    updates: UpdateChecker;
    /** The one-time library download; serve.ts triggers it after listen. */
    content: ContentFetcher;
  }
}

/** How this build reached the user's disk; decides which update path the UI offers. */
export type InstallKind = 'npx' | 'global' | 'managed' | 'dev' | 'unknown';

export interface ServerOptions {
  core: Core;
  engines: EngineRegistry;
  studioDist?: string; // path to built SPA; optional in tests
  fetchImpl?: typeof fetch;
  templatesDir?: string; // override for tests
  access?: AccessOptions; // host allowlist + LAN token; loopback-only by default
  /** Posture serve.ts works out from its own entry path; tests leave it unset. */
  runtime?: { installKind: InstallKind; supervised: boolean; launcherProtocol?: number; entry?: string };
  /** The staging function, injected in tests so no npm runs. */
  stageImpl?: typeof stageVersion;
  /** process.exit, injected in tests so the restart route can be observed. */
  exitImpl?: (code: number) => void;
  /** Upper bound on one node's whole run; tests shrink it. */
  nodeTimeoutMs?: number;
  /** Reads a brand's own references into structured records. Injected in tests. */
  analyzer?: Analyzer;
  /** Installs and signs in the local Codex CLI for the setup wizard. Injected in tests. */
  codexSetup?: CodexSetup;
}

/**
 * A stable number for one picture asked for one shape.
 *
 * Not randomness and not a hash of the world: the same source and the same
 * target frame must give the same seed on every machine and every run, so an
 * expansion a user re-runs returns what it returned before.
 */
function seedFor(sourceHash: string, width: number, height: number): number {
  let h = 2166136261;
  for (const ch of `${sourceHash}:${width}x${height}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2_147_483_647;
}

/** Settings keys exposed via the API. Secrets are write-only: reads return booleans. */
const SECRET_KEYS = ['openrouter_api_key', 'replicate_api_token', 'fal_key'];

export function buildServer(opts: ServerOptions): FastifyInstance {
  const { core, engines } = opts;
  const meta = readMeta();
  const app = Fastify({ logger: false });
  // First hook, before any route: Fastify only applies a hook to routes
  // registered after it was added.
  registerAccessGuard(app, opts.access);
  // In-flight cost reservations per engine: caps must count generations that
  // are still running, not just recorded cost_events, or N parallel requests
  // all pass the cap check against the same stale spend.
  const reserved = new Map<string, number>();
  // In-flight generations by node id, mirroring catalogImport.ts's own running
  // map: a node only ever leaves 'running' via the promise this map tracks, so
  // cancelling it is looking the controller up and aborting it.
  const runningGenerations = new Map<string, AbortController>();
  // Derivatives for every picture shown smaller than it is. Made when a shot
  // lands and on first request; the originals stay where they were.
  const thumbs = createThumbStore(core);
  const { scenes } = loadScenes(opts.templatesDir);
  // resolves a scene by its id or by any id it used to answer to
  const resolveScene = sceneResolver(scenes);
  /**
   * The same resolver, with the brand's own scenes ahead of the catalog.
   *
   * Same precedence a brand's `characters[]` already has over the presenter
   * catalog: what you built for yourself wins. Every compileBrief call site
   * uses this, so a brief carrying a custom scene compiles through exactly the
   * same path a curated one does.
   */
  const sceneFor = (brandJson: any) => (id: string) => brandSceneById(brandJson, id) ?? resolveScene(id);
  app.register(fastifyMultipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as { statusCode?: number; message?: string; code?: string };
    const status = err instanceof SpendCapError ? 402 : (e.statusCode ?? 500);
    // fs errors embed absolute paths ("ENOENT: … open '/Users/…'"); the path
    // belongs in the terminal, not in a response a browser can read.
    const leaksPath = typeof e.code === 'string' && /^(ENOENT|EACCES|EPERM|EISDIR|ENOTDIR)$/.test(e.code);
    reply.status(status).send({ error: leaksPath ? 'unexpected error' : (e.message ?? 'unexpected error') });
  });

  // ---- brands
  app.get('/api/brands', async () => core.store.listBrands());
  app.post('/api/brands', async (req, reply) => {
    const json = (req.body as any)?.brand;
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'invalid .brand', details: v.errors });
    return core.store.createBrand(json);
  });
  app.post('/api/brands/from-url', async (req, reply) => {
    const url = String((req.body as any)?.url ?? '');
    if (!/^https?:\/\//.test(url)) return reply.status(400).send({ error: 'url must be http(s)' });
    const { brand, warnings } = await buildFromUrl(url, {
      fetchImpl: opts.fetchImpl,
      // The store names every blob `<hash>.png` and /api/images/:hash always
      // serves image/png, so an un-normalized .ico or .svg here is a file lying
      // about its own format — broken in the marks grid, and mislabelled to any
      // engine it is later attached to.
      saveAsset: async (buf) => `asset:${core.images.save(await toMarkPng(buf))}`,
      // Measured as stored (post-toMarkPng), so the scrape judges the same
      // pixels the compiler will one day attach.
      probeLongEdge: async (buf) => {
        const m = await sharp(await toMarkPng(buf)).metadata();
        return Math.max(m.width ?? 0, m.height ?? 0) || null;
      },
      createdWith: `${meta.name}/${meta.version}`,
    });
    const row = core.store.createBrand(brand as any);
    return { ...row, warnings };
  });
  app.put('/api/brands/:id', async (req, reply) => {
    const json = (req.body as any)?.brand;
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'invalid .brand', details: v.errors });
    const row = core.store.updateBrand((req.params as any).id, json);
    return row ?? reply.status(404).send({ error: 'brand not found' });
  });
  app.delete('/api/brands/:id', async (req) => {
    core.store.deleteBrand((req.params as any).id);
    return { ok: true };
  });

  // ---- products (manual uploads to a brand's product library)
  // Characters/presenters no longer get a manual-add route: a presenter is
  // either in the curated catalog (see below) or, for older brands, already
  // sitting in `characters[]` from a cast made before that catalog existed.
  const ASSETS = {
    products: { key: 'products', prefix: 'p', fallback: 'Product' },
  } as const;
  /**
   * Two ways in, one row out.
   *
   * The multipart path is the original: one file, one product, and the client
   * has to guess which product it just made by diffing the library. The JSON
   * path takes hashes already put through POST /api/images — which normalizes
   * with the identical `sharp(buf).png()` — so a product with four angles is
   * one brand write instead of five, and the response says which id it is.
   *
   * `productId` rides beside the brand row rather than inside `json`, so the
   * schema's `additionalProperties: false` is untouched and every existing
   * caller still reads the same shape it always did.
   */
  const addAsset = (kind: keyof typeof ASSETS) => async (req: any, reply: any) => {
    const spec = ASSETS[kind];
    const brand = core.store.getBrand(req.params.id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });

    const isJson = String(req.headers['content-type'] ?? '').includes('application/json');
    let name: string;
    let hashes: string[];
    let category: string | undefined;

    if (isJson) {
      const body = (req.body ?? {}) as any;
      hashes = Array.isArray(body.imageHashes) ? body.imageHashes.map((h: unknown) => String(h)) : [];
      if (hashes.length === 0) return reply.status(400).send({ error: 'at least one image is required' });
      for (const h of hashes) {
        if (!/^[a-f0-9]{32}$/.test(h) || !core.images.has(h))
          return reply.status(400).send({ error: `unknown image ${h}` });
      }
      name =
        String(body.name ?? '')
          .trim()
          .slice(0, 80) || spec.fallback;
      const raw = body.category == null ? '' : String(body.category).slice(0, 500);
      category = raw || undefined;
    } else {
      const part = await readImagePart(core, req, toPng);
      if ('error' in part) return reply.status(400).send({ error: part.error });
      hashes = [part.hash];
      // The one place an uploaded FILENAME becomes user-visible data. Strip
      // invisible bidi controls (a filename is an attack surface for them) and
      // cut by code point, not UTF-16 unit — a raw .slice can halve a
      // surrogate pair and ship a broken character into the record.
      // The extension goes when the filename is only a fallback: the file is
      // "serum.png", the product is "serum", in any script.
      const explicit = part.fields?.name?.value;
      const fromFile = String(part.filename ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
      name =
        Array.from(
          String(explicit ?? (fromFile || spec.fallback)).replace(
            /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g,
            '',
          ),
        )
          .slice(0, 80)
          .join('')
          .trim() || spec.fallback;
    }

    const id = `${spec.prefix}-${randomUUID().slice(0, 8)}`;
    const json = { ...(brand.json as any) };
    json[spec.key] = [
      ...(json[spec.key] ?? []),
      {
        id,
        name,
        ...(category ? { category } : {}),
        shots: hashes.map((h) => ({ file: `asset:${h}`, locked: true })),
      },
    ];
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    const saved = core.store.updateBrand(brand.id, json);
    return isJson ? { ...saved, productId: id } : saved;
  };
  const removeAsset = (kind: keyof typeof ASSETS) => async (req: any, reply: any) => {
    const spec = ASSETS[kind];
    const brand = core.store.getBrand(req.params.id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const json = { ...(brand.json as any) };
    json[spec.key] = (json[spec.key] ?? []).filter((x: any) => x.id !== req.params.assetId);
    return core.store.updateBrand(brand.id, json);
  };
  app.post('/api/brands/:id/products', addAsset('products'));
  app.delete('/api/brands/:id/products/:assetId', removeAsset('products'));

  /**
   * Re-scrape the brand's own website into the kit it already has.
   *
   * Not the same thing as from-url, which creates: this one merges, and the
   * merge policy (see mergeScrape) is what keeps a refresh from quietly undoing
   * an afternoon of editing. Scraped colours come back as suggestions the page
   * offers, never as a write.
   */
  app.post('/api/brands/:id/refresh-from-url', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const url = String((req.body as any)?.url ?? (brand.json as any)?.meta?.website ?? '');
    if (!/^https?:\/\//.test(url)) return reply.status(400).send({ error: 'url must be http(s)' });
    const { brand: scraped, warnings } = await buildFromUrl(url, {
      fetchImpl: opts.fetchImpl,
      saveAsset: async (buf) => `asset:${core.images.save(await toMarkPng(buf))}`,
      probeLongEdge: async (buf) => {
        const m = await sharp(await toMarkPng(buf)).metadata();
        return Math.max(m.width ?? 0, m.height ?? 0) || null;
      },
      createdWith: `${meta.name}/${meta.version}`,
    });
    const { brand: merged, suggestions } = mergeScrape(brand.json, scraped);
    const v = validateBrand(merged);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    const row = core.store.updateBrand(brand.id, merged as any);
    return { ...row, warnings, suggestions };
  });

  registerLogoRoutes(app, { core });

  // Manual products only: category/variant/material/dimensions, set from the
  // product's own page. Name lives here too, so renaming doesn't need a
  // second endpoint.
  app.patch('/api/brands/:id/products/:productId', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const productId = String((req.params as any).productId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const json = { ...(brand.json as any) };
    const products: any[] = json.products ?? [];
    const idx = products.findIndex((p) => p.id === productId);
    if (idx === -1) return reply.status(404).send({ error: 'product not found' });
    const FIELDS = ['name', 'category', 'variant', 'material', 'dimensions'] as const;
    const patch: Record<string, unknown> = {};
    for (const f of FIELDS) if (f in body) patch[f] = body[f] == null ? undefined : String(body[f]).slice(0, 500);
    json.products = products.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
  });
  // Add one more reference angle to a product that already exists, rather
  // than creating a new one — what the Product page's add-angle tile uploads
  // into. Works for both kinds: a manual product's shots live in the brand
  // document, an imported one's in catalog_images under a `local:` URL that
  // marks it as ours so the next import carries it across.
  app.post('/api/brands/:id/products/:productId/shots', async (req: any, reply: any) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const productId = String((req.params as any).productId);
    const catalogId = productId.startsWith('cat-') ? productId.slice(4) : null;
    const json = { ...(brand.json as any) };
    const products: any[] = json.products ?? [];
    const idx = catalogId ? -1 : products.findIndex((p) => p.id === productId);
    const catalogRow = catalogId ? core.catalog.getProduct(catalogId) : null;
    if (idx === -1 && (!catalogRow || catalogRow.brandId !== brand.id)) {
      return reply.status(404).send({ error: 'product not found' });
    }
    const part = await readImagePart(core, req, toPng);
    if ('error' in part) return reply.status(400).send({ error: part.error });
    const hash = part.hash;
    const angle = part.fields?.angle?.value ? String(part.fields.angle.value).slice(0, 60) : undefined;
    if (catalogId) {
      core.catalog.addLocalImage(catalogId, `asset:${hash}`, angle ?? null);
      return core.store.getBrand(brand.id);
    }
    const shot: any = { file: `asset:${hash}`, locked: true };
    if (angle) shot.angle = angle;
    json.products = products.map((p, i) => (i === idx ? { ...p, shots: [...(p.shots ?? []), shot] } : p));
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
  });

  /**
   * Rewrite a product's reference set: the body is the order the user wants,
   * and anything left out is removed.
   *
   * One route rather than three, because promote, reorder and remove are the
   * same write — a product's shots are an ordered list and the compiler reads
   * meaning straight off that order (`shots[0]` is the essential reference,
   * and only the first PRODUCT_REF_MAX reach an engine at all). Additions keep
   * going through POST above; this only ever narrows or reorders what is here,
   * so it cannot smuggle in an image the product never had.
   */
  app.put('/api/brands/:id/products/:productId/shots', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const productId = String((req.params as any).productId);
    const body = (req.body ?? {}) as { files?: unknown };
    const files = Array.isArray(body.files) ? body.files.map((f) => String(f)) : null;
    if (!files || files.length === 0)
      return reply.status(400).send({ error: 'a product needs at least one reference' });
    if (new Set(files).size !== files.length) return reply.status(400).send({ error: 'duplicate reference' });

    if (productId.startsWith('cat-')) {
      const pid = productId.slice(4);
      const row = core.catalog.getProduct(pid);
      if (!row || row.brandId !== brand.id) return reply.status(404).send({ error: 'product not found' });
      const have = new Set(core.catalog.listImages(pid).map((i) => i.assetRef));
      if (files.some((f) => !have.has(f))) return reply.status(400).send({ error: 'unknown reference' });
      core.catalog.setImageOrder(pid, files);
      return core.store.getBrand(brand.id);
    }

    const json = { ...(brand.json as any) };
    const products: any[] = json.products ?? [];
    const idx = products.findIndex((p) => p.id === productId);
    if (idx === -1) return reply.status(404).send({ error: 'product not found' });
    const shots: any[] = products[idx].shots ?? [];
    const byFile = new Map(shots.map((s) => [s.file, s]));
    /*
     * A file may name an image the product does not currently hold, as long as
     * this machine has the image.
     *
     * Removing a reference from a manual product drops the entry but never the
     * blob — the store is content-addressed and keeps it. Refusing anything not
     * already in `shots` therefore made removal one-way for exactly the products
     * where it is most likely to be a slip, because "put it back" is naming the
     * same asset again. The guard that matters is that the asset exists at all,
     * which is the same bar `POST /products` sets for `imageHashes`.
     */
    const known = (f: string) => {
      if (byFile.has(f)) return true;
      const h = /^asset:([a-f0-9]{32})$/.exec(f)?.[1];
      return Boolean(h && core.images.has(h));
    };
    if (files.some((f) => !known(f))) return reply.status(400).send({ error: 'unknown reference' });
    // Carry each shot across whole — angle and locked belong to the image, not
    // to its position, and re-deriving them here would quietly drop them. One
    // coming back has no entry to carry, so it is rebuilt the way a fresh
    // upload arrives.
    json.products = products.map((p, i) =>
      i === idx ? { ...p, shots: files.map((f) => byFile.get(f) ?? { file: f, locked: true }) } : p,
    );
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
  });

  registerCatalogImportRoutes(app, { core, fetchImpl: opts.fetchImpl });

  // ---- scenes (+ their preview imagery when generated)
  const templatesRoot = opts.templatesDir ?? defaultScenesDir();
  registerSceneRoutes(app, { templatesRoot, scenes, thumbs });

  // ---- presenters (curated identity catalog). A presenter attaches straight
  // into a brief like a Scene does — see brandJsonWithResolvedPresenters below.
  const presentersDir = join(templatesRoot, 'presenters');
  const { presenters } = loadPresenters(presentersDir);
  registerPresenterRoutes(app, { templatesRoot, presenters, thumbs });

  // ---- custom presenters and scenes (the ones a brand builds for itself)
  //
  // These live in the brand document, not in templates/, and everything past
  // this point treats them identically to the curated ones: compileBrief
  // already prefers `characters[]` over the presenter catalog, and the scene
  // resolver below prefers `scenes[]` over the scene catalog.
  registerAssetBuildRoutes(app, { core, engines, analyzer: opts.analyzer, scenes, presenters });

  // ---- demo products (curated, fictional-but-premium product catalog). A
  // demo product attaches straight into a brief like a Presenter does — see
  // brandJsonWithResolvedDemoProducts below. Never touches a real brand's
  // own products[].
  const { demoProducts } = loadDemoProducts(join(templatesRoot, 'demo-products'));
  const demoProductById = demoProductResolver(demoProducts);
  // Thumbnail is always the category's "primary" angle (three-quarter where
  // the category has one, else front) — a slightly dimensional hero shot,
  // never a creative-campaign image. See primaryAngleFor/demoProductRefPath.
  registerDemoProductRoutes(app, { templatesRoot, demoProducts, demoProductById, thumbs });

  registerShowcaseRoutes(app, { templatesRoot });

  // ---- brief compiler: the composer previews exactly what will run
  app.get('/api/formats', async () => FORMATS);
  /**
   * The one truth for what an edit carries: what the refinement brief attaches
   * itself, what it inherits from the thread it refines, and which of all that
   * survives the engine's budget with the source frame holding one slot.
   *
   * Both the preview route and the addNode route go through here, so the strip
   * the composer shows before sending and the request the engine receives can
   * never disagree. Compiles run uncapped and the ROUTE allocates, because the
   * compiler's own clamp cannot see the inherited attachments and would
   * pre-drop under the wrong budget.
   */
  /**
   * A brief posted to the server can be a stored brief coming back verbatim —
   * Try again re-sends `node.brief` whole — and a stored brief carries the RUN
   * RECORD of the run that made it: what it inherited, the delivered pixel
   * sizes, crop and resize provenance, the expand plan. Those are outputs,
   * written by each run after it happens; spreading them onto a new node
   * persists a record describing a different run. Only the inputs survive
   * here. `reshape` stays: it is a declared input, read back above.
   */
  function briefInputsOnly(brief: object): object {
    const {
      inherited,
      rendered,
      croppedFrom,
      resizedFrom,
      resampledHops,
      steppedDown,
      gradeComposited,
      expand,
      crop,
      sourceImage,
      ...inputs
    } = brief as Record<string, unknown>;
    return inputs;
  }

  async function compileEditBrief(
    brandId: string,
    parentId: string,
    brief: Brief,
    engineCaps: EngineCapabilities,
    opts?: { reshape?: 'crop' | 'extend' },
  ) {
    const inherited = inheritedIdentityTokens(parentId, (id) => core.store.getNode(id));
    const borrowed = inherited.tokens;
    // The studio's own identity rule: a product keys on its id, so re-asking
    // for a carried product at another angle never records it twice.
    const already = new Set(
      (brief.tokens as BriefToken[])
        .filter((t) => t.t === 'product' || t.t === 'character' || t.t === 'mark' || t.t === 'ref')
        .map(identityTokenKey),
    );
    const inheritedTokens = borrowed.filter((t) => !already.has(identityTokenKey(t)));
    // The catalogs resolve only the ids they are shown, so a carried demo
    // product or curated presenter must be in the token list the brand json
    // is built against, or it compiles to "no longer in the kit".
    const combined = [...(brief.tokens as BriefToken[]), ...inheritedTokens];
    // A refinement conditions on the same faces a generation does. The
    // identity chain is the one place fidelity compounds -- five consecutive
    // re-renders of the same person -- so this is the last place that should
    // be handed the weaker payload.
    const brandJson = await brandJsonWithIdentityCrops(
      core,
      await brandJsonWithResolvedPresenters(
        core,
        templatesRoot,
        presenters,
        await brandJsonWithResolvedDemoProducts(
          core,
          templatesRoot,
          demoProducts,
          brandJsonWithCatalogProducts(core, brandId),
          combined,
        ),
        combined,
      ),
      combined.filter((t): t is Extract<BriefToken, { t: 'character' }> => t.t === 'character').map((t) => t.id),
    );
    const sceneById = sceneFor(brandJson);
    const uncapped = { ...engineCaps, maxReferenceImages: 32 };
    const verdict = scopeOfInstruction(
      (brief.tokens as BriefToken[])
        .filter((t): t is Extract<BriefToken, { t: 'text' }> => t.t === 'text')
        .map((t) => t.v)
        .join(' '),
    );
    /*
     * What must hold about each inherited identity, in words. The synthetic
     * compile below carries only attachments, so the record's own facts —
     * preservation notes, materials, dimensions, the identity lock — used to
     * vanish from every refinement while its prompt claimed identity was
     * preserved. Built from the same resolved records the attachments come
     * from, and emitted inside the edit-only preservation block.
     */
    const inheritedDirectives: string[] = [];
    let inheritedMark = false;
    let inheritedRef = false;
    const inheritedProduct = inheritedTokens.some((t) => t.t === 'product');
    const inheritedPerson = inheritedTokens.some((t) => t.t === 'character');
    for (const tok of inheritedTokens) {
      if (tok.t === 'product') {
        const rec = (brandJson?.products ?? []).find((x: any) => x?.id === (tok as any).id);
        if (rec)
          inheritedDirectives.push(
            productEditFidelityDirective(rec.promptName ?? rec.name),
            ...productFactDirectives(rec),
          );
      } else if (tok.t === 'character') {
        const rec = (brandJson?.characters ?? []).find((x: any) => x?.id === (tok as any).id);
        if (rec)
          inheritedDirectives.push(
            characterEditIdentityDirective(rec.promptName ?? rec.name),
            ...characterFactDirectives(rec),
          );
      } else if (tok.t === 'mark' && !inheritedMark) {
        inheritedMark = true;
        inheritedDirectives.push(markEditDirective());
      } else if (tok.t === 'ref' && !inheritedRef) {
        // The one inherited kind that had no scoping sentence: the generic
        // identity claim called a carried mood image "the same person" while
        // the adapter called it composition-only. Say what it is for, once.
        inheritedRef = true;
        inheritedDirectives.push(inheritedRefDirective());
      }
    }
    // The skin floor is gated on a character TOKEN inside compileBrief, and a
    // refine brief carries none - so the one place the waxy look compounds
    // (five consecutive re-renders) was the one place the floor never fired.
    // The inherited person is a person in frame; the floor rides with them.
    if (inheritedPerson) inheritedDirectives.push(personSkinDirective());
    const compileCtx = {
      brand: brandJson,
      images: core.images,
      wordsFor: shotWordsFor(core, brandId),
      engineCaps: uncapped,
      template: brief.templateId ? sceneById(String(brief.templateId)) : undefined,
      templateById: sceneById,
      mode: 'edit' as const,
      editScope: verdict.scope,
      editRemoval: verdict.removal ?? false,
      // Kinds, not a count: the identity claim speaks only about the kinds
      // that actually ride. A mark-only or ref-only inheritance emits no
      // generic claim - markEditDirective and inheritedRefDirective speak
      // for themselves.
      inheritedIdentity:
        inheritedProduct || inheritedPerson ? { product: inheritedProduct, person: inheritedPerson } : false,
      inheritedDirectives,
      // Only the explicit op drops the dimension promise: an implicit legacy
      // expansion keeps its historical prompt byte for byte.
      ...(opts?.reshape === 'extend' ? { editReshape: 'extend' as const } : {}),
    };
    const compiled = compileBrief(brief, compileCtx);
    let inheritedAttachments: Attachment[] = [];
    let identityWarnings: string[] = [];
    if (inheritedTokens.length) {
      // Compiled from a synthetic brief so the compiler stays the single
      // definition of what a token attaches.
      // mode 'edit' is belt and braces here: the walk never inherits a
      // template token (IDENTITY_KINDS), but if that Set ever grows one, the
      // compiler's own edit gate is what keeps a scene photograph from
      // re-entering every refinement through this synthetic compile.
      const identity = compileBrief(
        { tokens: inheritedTokens },
        { brand: brandJson, images: core.images, engineCaps: uncapped, templateById: sceneById, mode: 'edit' as const },
      );
      // The synthetic compile runs uncapped, so any warning it raises is a
      // resolution failure - a carried mark whose logo left the kit, an image
      // missing from the store. Discarding these meant a refine could shed the
      // brand mark the detail view still lists, with nothing said to anyone.
      identityWarnings = identity.warnings;
      // Essentials carry the subject; a brand mark or a reference is one image
      // each and IS the identity being carried — the old essential-only filter
      // silently dropped an inherited logo while the prompt claimed identity
      // was preserved. A product borrows one corroboration angle beyond its
      // essential: a label edit needs the face the frame does not show, and
      // the allocator only seats the extra angle after every distinct identity
      // has a seat, so a full frame on a tight budget is unchanged. A
      // presenter stays at one view — the face in play is already in the
      // frame, and their second reference competes with the product's label.
      const productAngles = new Map<string, number>();
      inheritedAttachments = identity.attachments
        .filter((a) => {
          if (a.role === 'product') {
            const n = (productAngles.get(String(a.id ?? a.hash)) ?? 0) + 1;
            productAngles.set(String(a.id ?? a.hash), n);
            return n <= 2;
          }
          return a.essential || a.role === 'brand' || a.role === 'reference';
        })
        .map((a) => ({ ...a, inherited: true }));
    }
    const cap = Math.max(0, engineCaps.maxReferenceImages - 1);
    // `seated`, not `attachments`: the compile above hands back its images
    // re-sorted by role, and a second allocation from that order pictured
    // every product before any face on a refinement whatever the line said.
    const merged = mergeEditAttachments(compiled.seated, inheritedAttachments, cap);
    // The instruction's own attachment claims must match the ONE allocation
    // made here, not the uncapped compile above: a mark this merge dropped
    // used to leave "the attached brand mark ... reproduce it exactly" in the
    // prompt with no mark attached. Deterministic and cheap, so the prompt is
    // simply compiled again against the survivors.
    const prompt = compileBrief(brief, { ...compileCtx, presentAttachments: merged.kept }).prompt;
    const warnings = [...compiled.warnings, ...identityWarnings.filter((w) => !compiled.warnings.includes(w))];
    if (inherited.truncated)
      warnings.push('This thread is deeper than 64 steps, so identity attached before that could not be carried.');
    // An engine that carries nothing beyond the frame is not a reason to
    // refuse: unlike a generation, the subject is already in the picture. On an
    // engine that reads more, whatever found no seat is described in words by
    // the compile above, and the composer dimmed its chip before the send; a
    // warning that it "was left out" would contradict both.
    if (merged.dropped.length && engineCaps.maxReferenceImages <= 1)
      warnings.push(`The identity rides on the shot itself — ${engineCaps.displayName} reads no other images.`);
    return {
      compiled: { ...compiled, prompt },
      inheritedTokens,
      merged,
      /** The seats this refinement had: the engine's, less the source frame. */
      cap,
      warnings,
      editScope: verdict.scope,
      editRemoval: verdict.removal ?? false,
    };
  }

  app.post('/api/brief/preview', async (req, reply) => {
    const { brief, engineId, brandId, parentId } = req.body as any;
    const brand = core.store.getBrand(String(brandId));
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const engine = engines.get(String(engineId));
    if (!engine) return reply.status(400).send({ error: 'unknown engine' });
    if (!brief || !Array.isArray(brief.tokens))
      return reply.status(400).send({ error: 'brief.tokens must be an array' });
    const briefErrors = validateBrief(brief);
    if (briefErrors.length) return reply.status(400).send({ error: `invalid brief: ${briefErrors.join('; ')}` });

    // A preview WITH a parent is a refine preview: it runs the exact path the
    // send will run, inheritance and budget included, so the context strip the
    // composer draws is the request the engine will receive.
    if (parentId && core.store.getNode(String(parentId))) {
      const previewReshape = (req.body as any).reshape;
      const edit = await compileEditBrief(brand.id, String(parentId), brief as Brief, engine.capabilities(), {
        reshape: previewReshape === 'extend' ? 'extend' : previewReshape === 'crop' ? 'crop' : undefined,
      });
      const { referenceImages, ...rest } = edit.compiled;
      return {
        ...rest,
        attachments: edit.merged.kept,
        // The own compile runs uncapped, so its dropped list holds exactly the
        // missing-photo identities; the budget losses live on the merge.
        dropped: [...edit.compiled.dropped, ...edit.merged.dropped],
        warnings: edit.warnings,
        referenceCount: edit.merged.kept.length,
        // How many photo groups this refine can carry in total: the engine's
        // slots less the one the source frame holds. The composer refuses a
        // pick past it rather than warning after the fact.
        cap: edit.cap,
      };
    }

    // Identity crops here too, and for the reason the file header gives: what
    // the composer previews and what the engine receives can never drift. The
    // preview is the same compile, so it has to be handed the same roster.
    const brandJson = await brandJsonWithIdentityCrops(
      core,
      await brandJsonWithResolvedPresenters(
        core,
        templatesRoot,
        presenters,
        await brandJsonWithResolvedDemoProducts(
          core,
          templatesRoot,
          demoProducts,
          brandJsonWithCatalogProducts(core, brand.id),
          brief.tokens,
        ),
        brief.tokens,
      ),
      ((brief.tokens as BriefToken[] | undefined) ?? [])
        .filter((t): t is Extract<BriefToken, { t: 'character' }> => t.t === 'character')
        .map((t) => t.id),
    );
    const sceneById = sceneFor(brandJson);
    const compiled = compileBrief(brief as Brief, {
      brand: brandJson,
      images: core.images,
      wordsFor: shotWordsFor(core, brand.id),
      engineCaps: engine.capabilities(),
      template: brief.templateId ? sceneById(String(brief.templateId)) : undefined,
      templateById: sceneById,
    });
    // paths are server-side detail; the UI works in hashes
    const { referenceImages, ...rest } = compiled;
    return { ...rest, referenceCount: referenceImages.length, cap: engine.capabilities().maxReferenceImages };
  });

  registerProjectRoutes(app, {
    core,
    // what a search may match a brief token by: every name a token can carry today
    tokenNames: (brand) => [
      ...core.catalog.listLibraryProducts(brand.id, brand.json).map((p) => ({ id: p.id, name: p.name })),
      ...demoProducts.map((p) => ({ id: p.id, name: p.name })),
      ...brandCharacters(brand.json).map((c: any) => ({ id: String(c.id), name: String(c.name ?? '') })),
      ...presenters.map((p) => ({ id: p.id, name: p.name })),
      ...brandScenes(brand.json).map((sc) => ({ id: sc.id, name: sc.name })),
      ...scenes.map((sc) => ({ id: sc.id, name: sc.name })),
    ],
    engineNames: () => engines.all().map((e) => ({ id: e.capabilities().id, name: e.capabilities().displayName })),
  });

  registerCodexSetupRoutes(app, { codexSetup: opts.codexSetup, codexRunner: engines.codexRunner });

  // ---- engines / caps / costs
  app.get('/api/engines', async () => {
    const list = [];
    for (const e of engines.all()) {
      const caps = e.capabilities();
      const avail = await e.isAvailable();
      const spend = core.ledger.monthlySpend(caps.id);
      const cap = core.ledger.capFor(caps.id);
      // Credits are generations, not dollars: probe the engine's own estimate
      // for one standard image and convert the remaining budget into runs.
      let perGeneration = 0;
      try {
        perGeneration = await e.costEstimate({
          prompt: '',
          brand: { brand: {}, assetPaths: {} },
          width: 1024,
          height: 1024,
          count: 1,
        } as any);
      } catch {
        perGeneration = 0;
      }
      // "free" here means unpriceable by us, not costless to them. See the same
      // flag on /api/asset-builds/capabilities.
      const free = perGeneration <= 0;
      const generationsLeft = free || cap === null ? null : Math.max(0, Math.floor((cap - spend) / perGeneration));
      const generationsTotal = free || cap === null ? null : Math.max(0, Math.floor(cap / perGeneration));
      list.push({
        ...caps,
        available: avail.ok,
        reason: avail.reason ?? null,
        // Which setup step would fix this, when the engine knows. The wizard
        // switches on this instead of matching on prose.
        code: avail.code ?? null,
        monthlySpend: spend,
        cap,
        free,
        perGeneration,
        generationsLeft,
        generationsTotal,
      });
    }
    return list;
  });
  app.put('/api/caps', async (req) => {
    const { engineId, capUsd } = req.body as any;
    core.ledger.setCap(String(engineId), capUsd === null ? null : Number(capUsd));
    return { ok: true };
  });
  app.get('/api/costs/summary', async () => ({ byEngine: core.ledger.totalSpendByEngine(), caps: core.ledger.caps() }));

  // ---- settings (secrets write-only)
  app.get('/api/settings', async () => {
    const all = core.store.allSettings();
    const out: Record<string, unknown> = {};
    for (const k of SECRET_KEYS) out[k] = Boolean(all[k] || process.env[k.toUpperCase()]);
    // The one non-secret: a real boolean, not an is-it-set flag.
    out.updateCheck = updates.enabled();
    return out;
  });
  app.put('/api/settings', async (req) => {
    const body = req.body as Record<string, unknown>;
    for (const k of SECRET_KEYS) if (typeof body[k] === 'string') core.store.setSetting(k, body[k] as string);
    if (typeof body.updateCheck === 'boolean') core.store.setSetting('update.enabled', String(body.updateCheck));
    return { ok: true };
  });

  // ---- nodes: async generation/edit
  async function normalizePngs(images: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const h of images) {
      const buf = core.images.read(h);
      // metadata() is the validation AND the orientation sniff in one header
      // read: garbage that is not an image throws here with a message that
      // names the real failure, instead of far away in a resize or a browser.
      const meta = await sharp(buf)
        .metadata()
        .catch(() => null);
      if (!meta?.width || !meta.height) throw new Error('engine returned an undecodable image');
      // Bake in EXIF orientation the way the upload path always has
      // (routes/images.ts): a tagged file measures one way in sharp and
      // renders another way in the browser, which is a rotated feed tile
      // nothing in the metadata explains. Untagged PNGs pass through
      // hash-identical - no re-encode cost on the common path.
      const oriented = (meta.orientation ?? 1) !== 1;
      out.push(
        buf.subarray(0, 8).equals(PNG_SIG) && !oriented
          ? h
          : core.images.save(await sharp(buf).rotate().png().toBuffer()),
      );
    }
    return out;
  }

  /**
   * The furthest a delivered frame may drift from the asked ratio and still be
   * conformable by an attention-placed crop.
   *
   * 0.35, calibrated on live failures rather than on doctrine. The neutral
   * probe measured 0.1% drift, but real briefs full of scene prose pull the
   * tool to its own grid: a figure-led 4:5 ask repeatedly came back 1003x1568,
   * 20.04% off, and the first cap of 0.20 missed it by four hundredths of a
   * point - a wall of failed draws on release night. A 35% crop trims at most
   * about a quarter of one axis with attention placement choosing the strip,
   * which is a usable photograph; a failed node is spent quota and nothing.
   * Even a square answered for a 4:5 (25%) is better cropped than refused.
   * Past this, the shape is unrelated to the ask and the node still fails.
   */
  const CROPPABLE_DRIFT = 0.35;

  /**
   * Conform a drifted frame to the asked ratio by CROPPING, never scaling.
   *
   * Codex's image tool honours a requested ratio closely but not exactly, and
   * it cannot be handed a pixel size at all - the old answer was letting the
   * model shell-resize, which sheared the picture (the crushed-faces report).
   * A crop keeps every surviving pixel at its own scale: one axis is kept
   * whole, the other trimmed, with sharp's attention positioning deciding
   * which strip survives. Within SAME_SHAPE_TOL nothing is touched (that band
   * belongs to the canvas pass), and beyond CROPPABLE_DRIFT nothing is
   * touched either - assertAspect owns the refusal.
   *
   * Returns the images, and records croppedFrom on the brief when it acted.
   */
  function conformToCanvas(nodeId: string, want: { width: number; height: number }) {
    return async (images: string[]): Promise<string[]> => {
      const target = want.width / want.height;
      const out: string[] = [];
      for (const h of images) {
        const buf = core.images.read(h);
        const meta = await sharp(buf).metadata();
        if (!meta.width || !meta.height) {
          out.push(h);
          continue;
        }
        const got = meta.width / meta.height;
        const drift = Math.abs(got - target) / target;
        if (drift <= SAME_SHAPE_TOL || drift > CROPPABLE_DRIFT) {
          out.push(h);
          continue;
        }
        // One axis stays whole; the other is trimmed to the asked ratio at
        // the frame's own scale, so this is a placement decision, not a
        // resample.
        const w = got > target ? Math.round(meta.height * target) : meta.width;
        const hpx = got > target ? meta.height : Math.round(meta.width / target);
        const cropped = await sharp(buf).resize(w, hpx, { fit: 'cover', position: 'attention' }).png().toBuffer();
        app.log.info(
          { nodeId, got: `${meta.width}x${meta.height}`, want: `${w}x${hpx}` },
          'canvas: cropped a drifted frame to the asked ratio',
        );
        out.push(core.images.save(cropped));
        try {
          const fresh = core.store.getNode(nodeId);
          const b = (fresh?.brief as object | null) ?? {};
          core.store.setBrief(nodeId, { ...b, croppedFrom: [meta.width, meta.height] });
        } catch {
          /* the record is a convenience; failing to write it must not fail the run */
        }
      }
      return out;
    };
  }

  /**
   * A returned image whose shape does not match the requested shape is a
   * failed generation, not a successful one with a caveat: a 4:5 portrait
   * silently answered with a square has lost the composition the user asked
   * for. Some providers quantize to a fixed ratio menu and never say so
   * (replicate's `aspect_ratio` has no portrait option at all), so the only
   * reliable detector is measuring what actually came back.
   *
   * Shares ASPECT_TOLERANCE with the engines' own request-time refusal, so an
   * engine can never snap in a way this check would then reject.
   */
  async function assertAspect(images: string[], expect: { width: number; height: number }) {
    const want = expect.width / expect.height;
    for (const h of images) {
      const meta = await sharp(core.images.read(h)).metadata();
      if (!meta.width || !meta.height) continue;
      const got = meta.width / meta.height;
      if (Math.abs(got - want) / want > ASPECT_TOLERANCE)
        throw new Error(
          `engine returned ${meta.width}x${meta.height} for a ${expect.width}x${expect.height} request: ` +
            'this engine cannot produce the requested aspect ratio',
        );
    }
  }

  /**
   * The default node bound, for edits and for engines that make a single
   * provider call however many images are asked for. An engine that fans out
   * per image declares `perImageTimeoutMs` and gets a wave-scaled budget at the
   * runNode call site instead: a flat ten minutes was arithmetically wrong for
   * large batches — eight variants are four 300s waves. The tester's 500
   * seconds of silent nothing still sits inside whichever bound applies.
   */
  const NODE_TIMEOUT_MS = 600_000;

  async function runNode(
    /**
     * The nodes this one engine call fills, in slot order. An edit or crop is
     * a batch of one; a multi-shot generation is N sibling nodes sharing the
     * call, the reservation, the watchdog and the abort controller — cancel
     * any of them and the whole call stops, which is the honest reading of
     * one provider request.
     */
    nodeIds: string[],
    /** Null for local work that touches no provider — a pure crop. */
    engine: EngineAdapter | null,
    estimate: number,
    work: (
      signal: AbortSignal,
      onImage: OnImageLanded,
    ) => Promise<{ images: string[]; costUsd: number; raw?: unknown }>,
    expect?: { width: number; height: number },
    /**
     * Per-node post pass over that node's image, before anything is stored.
     * Expansion uses it to lay the untouched original back over the margin
     * the engine made, which is the only way any of this can be a guarantee:
     * no provider we can reach promises to leave a region alone. A factory
     * rather than one closure, because canvas conformance writes provenance
     * onto the node it is conforming — one shared closure once meant the
     * last-cropped image's record overwrote everyone else's.
     */
    postFor?: (nodeId: string) => ((images: string[]) => Promise<string[]>) | undefined,
    /** Overrides the default bound — derived per engine and batch by the caller. */
    timeoutMs?: number,
  ) {
    const engineId = engine?.capabilities().id ?? 'local';
    reserved.set(engineId, (reserved.get(engineId) ?? 0) + estimate);
    const ctrl = new AbortController();
    for (const id of nodeIds) runningGenerations.set(id, ctrl);
    // The last line of defense: whatever the engine's own timers do, no node
    // sits in `running` past this. A multi-variant codex batch can legally
    // outlive a single per-exec timeout, so the bound lives here, per run.
    const bound = opts.nodeTimeoutMs ?? timeoutMs ?? NODE_TIMEOUT_MS;
    let watchdogFired = false;
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      // Named, so an adapter can tell the caller giving up on the rest of a run
      // from the user cancelling it, and keep whatever already landed.
      ctrl.abort(BUDGET_EXHAUSTED);
    }, bound);
    const startedAt = Date.now();
    /** Nodes already given their outcome; the catch below settles the rest. */
    const settled = new Set<string>();
    /**
     * One slot, settled on its own: normalized, post-processed, measured and
     * marked done (or failed) the moment its image exists. This was the body
     * of a loop that ran only after the WHOLE call had resolved, so a four-shot
     * run showed nothing until its slowest exec was in. An adapter that can
     * tell its slots apart now reports each as it lands and the slot settles
     * at once; the loop after the call picks up only the slots nobody reported.
     * Its own try/catch, so one shot's bad frame fails that shot, never its
     * siblings.
     */
    const settleSlot = async (slot: number, hash: string) => {
      const id = nodeIds[slot];
      try {
        let own = await normalizePngs([hash]);
        const post = postFor?.(id);
        if (post) own = await post(own);
        if (expect) await assertAspect(own, expect);
        // What was actually delivered, next to what was asked for. Written
        // BEFORE completeNode, because `done` is what everything else waits
        // on: the studio polls until a node is done and then reads
        // rendered.sizes for the tile's shape (CI, 2026-08-30).
        try {
          const meta = await sharp(core.images.read(own[0])).metadata();
          const node = core.store.getNode(id);
          if (node && meta.width && meta.height) {
            const brief = (node.brief as object | null) ?? {};
            const asked = expect ? { requestedSize: [expect.width, expect.height] } : {};
            core.store.setBrief(id, { ...brief, rendered: { sizes: [[meta.width, meta.height]], ...asked } });
            // Codex's image tool cannot be handed a pixel size, so a
            // non-square generation landing EXACTLY on the requested pixels
            // is the signature of a forbidden shell resize. A log line,
            // never a reject: the native menu is not contractually known.
            if (
              node.kind === 'generation' &&
              engineId === 'codex-cli' &&
              expect &&
              expect.width !== expect.height &&
              meta.width === expect.width &&
              meta.height === expect.height
            )
              app.log.warn(
                { nodeId: id },
                'codex delivered exactly the requested pixels; its image tool cannot pin size - suggests a forbidden shell resize',
              );
          }
        } catch {
          /* the record is a convenience; failing to write it must not fail the run */
        }
        // Each sibling reports its own wall time: the moment its picture was
        // usable, measured from the request. The run's money is not known
        // until the whole call resolves, so it is written then, once, onto
        // the first sibling (chargeNode below), and the ledger gets one row.
        core.store.completeNode(id, { images: own, costUsd: 0, durationMs: Date.now() - startedAt });
        // the tile asks for the 640 derivative the moment it learns the shot
        // is done; making it now means that first paint never waits on sharp
        thumbs.warm(own[0]);
      } catch (err: any) {
        core.store.failNode(id, String(err?.message ?? err));
      } finally {
        settled.add(id);
      }
    };
    /** Slots the adapter reported early, each settling on its own promise. */
    const landing = new Map<number, Promise<void>>();
    let accepting = true;
    const onImage: OnImageLanded = (slot, hash) => {
      if (!accepting || !Number.isInteger(slot) || slot < 0 || slot >= nodeIds.length || landing.has(slot)) return;
      landing.set(slot, settleSlot(slot, hash));
    };
    try {
      const result = await work(ctrl.signal, onImage);
      accepting = false;
      // The watchdog bounds the engine, not the local post-processing. Left
      // armed past this point, a slow normalize/post/aspect pass could cross
      // the mark and its own failure would then be reported as a timeout —
      // a SUCCESSFUL generation labelled "took too long".
      clearTimeout(watchdog);
      // Whatever landed early finishes settling before the leftovers are
      // judged, or a slot could be failed as missing mid-pipeline.
      await Promise.allSettled(landing.values());
      // One image per node: image k belongs to requested slot variantIndexes[k]
      // (a partial codex batch says which slots survived; every other engine
      // returns a full run, so k maps to k). A slot with nothing behind it
      // becomes an honest failed node instead of a silently shorter run.
      const raw = result.raw as
        | { requested?: number; variantIndexes?: number[]; partialFailures?: string[] }
        | undefined;
      const bySlot: (string | undefined)[] = new Array(nodeIds.length);
      result.images.forEach((h, k) => {
        const slot = raw?.variantIndexes?.[k] ?? k;
        if (slot < nodeIds.length && bySlot[slot] === undefined) bySlot[slot] = h;
      });
      const failures = [...(raw?.partialFailures ?? [])];
      for (let slot = 0; slot < nodeIds.length; slot++) {
        if (landing.has(slot)) continue;
        const hash = bySlot[slot];
        if (hash === undefined) {
          core.store.failNode(nodeIds[slot], failures.shift() ?? 'the engine returned no image for this shot');
          settled.add(nodeIds[slot]);
          continue;
        }
        await settleSlot(slot, hash);
      }
      // The run's cost and wall time were measured once, for the whole call:
      // the ledger gets one row and the first node carries the money, so the
      // cap arithmetic stays exact.
      core.store.chargeNode(nodeIds[0], result.costUsd);
      core.ledger.recordCost(engineId, nodeIds[0], result.costUsd);
    } catch (err: any) {
      accepting = false;
      // a slot still settling keeps settling: its picture exists whatever
      // happened to the rest of the call
      await Promise.allSettled(landing.values());
      // the signal is the source of truth for "was this a cancel", not the
      // error shape, which differs across engines (fetch's AbortError, a
      // killed child process, a stopped poll loop) — except the watchdog,
      // whose abort is a failure with a name, never a user cancel. Every node
      // the fan-out did not reach gets the same outcome: they shared one call.
      for (const id of nodeIds) {
        if (settled.has(id)) continue;
        if (watchdogFired) core.store.failNode(id, `generation timed out after ${Math.round(bound / 60_000)} minutes`);
        else if (ctrl.signal.aborted) core.store.cancelNode(id);
        else core.store.failNode(id, String(err?.message ?? err));
      }
    } finally {
      clearTimeout(watchdog);
      for (const id of nodeIds) runningGenerations.delete(id);
      const left = (reserved.get(engineId) ?? 0) - estimate;
      if (left > 1e-9) reserved.set(engineId, left);
      else reserved.delete(engineId);
    }
  }

  app.post('/api/nodes', async (req, reply) => {
    const {
      projectId,
      parentId = null,
      kind,
      prompt,
      engineId,
      count = 1,
      templateId,
      templateFields,
      productId,
      brief,
    } = req.body as any;
    let { width = 1024, height = 1024 } = req.body as any;
    const project = core.store.getProject(String(projectId));
    if (!project) return reply.status(404).send({ error: 'project not found' });

    /**
     * Which reshape op an edit with a new shape means. Absent keeps the
     * historical behaviour (an expansion when the format differs); 'extend'
     * makes that explicit; 'crop' takes the dedicated path below.
     */
    // The stored brief is the fallback: Try again reposts a node's brief
    // verbatim without the top-level field, and a crop that silently re-runs
    // as an expansion is the worst kind of surprise. Legacy briefs carry no
    // reshape key, so the historical implicit path is untouched.
    const rawReshape = (req.body as any).reshape ?? (req.body as any).brief?.reshape;
    const reshape: 'crop' | 'extend' | undefined =
      rawReshape === 'crop' ? 'crop' : rawReshape === 'extend' ? 'extend' : undefined;

    /*
     * The local crop, shared by its two entries: the explicit reshape below,
     * and the classifier inside the edit branch when the geometry says a crop
     * is the honest op. Pure geometry, no provider, no cost — the output is a
     * rectangle of the original's own decoded pixels, re-encoded lossless, run
     * through the one node lifecycle so history, polling and failure handling
     * stay uniform.
     */
    const runCropNode = async (args: {
      parentId: string;
      fmt: { id?: unknown; w: unknown; h: unknown };
      srcHash: string;
      srcBuf: Buffer;
      srcSize: { width: number; height: number };
      note?: string;
    }) => {
      const plan = planCrop(args.srcSize, Number(args.fmt.w) / Number(args.fmt.h));
      if (!plan) return reply.status(400).send({ error: 'the picture is already this shape' });
      // The window follows the subject, not the center; still original pixels
      // only — attentionCropOrigin discovers an offset and nothing else.
      const origin = await attentionCropOrigin(args.srcBuf, args.srcSize, plan);
      const window = { left: origin.left, top: origin.top, width: plan.width, height: plan.height };

      const label = FORMATS.find((f) => f.id === args.fmt.id)?.label ?? `${args.fmt.w}x${args.fmt.h}`;
      const node = core.store.addNode({
        projectId: project.id,
        parentId: args.parentId,
        kind: 'edit',
        prompt: `Cropped to ${label}`,
        // No provider was asked; recording the engine the client HAPPENED to
        // have selected made the overlay display a name that did nothing.
        engineId: 'local',
      });
      // The brief records the window actually cut, so history and the pixel
      // tests speak about the same rectangle the picture came from.
      core.store.setBrief(node.id, {
        ...briefInputsOnly((brief as object) ?? {}),
        sourceImage: args.srcHash,
        reshape: 'crop',
        crop: window,
      });
      const work = async () => ({
        images: [core.images.save(await sharp(args.srcBuf).extract(window).png().toBuffer())],
        costUsd: 0,
      });
      void runNode([node.id], null, 0, work, { width: plan.width, height: plan.height }).catch((err) =>
        app.log.error({ err }, 'crop run failed'),
      );
      return reply.status(202).send(args.note ? { ...node, warnings: [args.note] } : node);
    };

    /*
     * A pure crop, before the engine gate on purpose: it is geometry, not
     * generation. No provider is asked, no prompt is compiled, no engine needs
     * to exist or be signed in.
     */
    if (kind === 'edit' && reshape === 'crop') {
      const rootForCrop = core.store.rootFor(project.id);
      if (!rootForCrop) return reply.status(500).send({ error: 'project has no root node' });
      const cropParentId = parentId ? String(parentId) : rootForCrop.id;
      if (brief && Array.isArray(brief.tokens)) {
        const briefErrors = validateBrief(brief);
        if (briefErrors.length) return reply.status(400).send({ error: `invalid brief: ${briefErrors.join('; ')}` });
      }
      const fmt = Array.isArray(brief?.tokens)
        ? (brief.tokens as BriefToken[]).find(
            (t): t is Extract<BriefToken, { t: 'format' }> => t.t === 'format' && Number(t.w) > 0 && Number(t.h) > 0,
          )
        : undefined;
      if (!fmt) return reply.status(400).send({ error: 'a crop needs a target format' });
      const parent = core.store.getNode(cropParentId);
      const srcHash = (req.body as any).sourceImage ?? parent?.images[0];
      if (!srcHash || !core.images.has(String(srcHash)))
        return reply.status(400).send({ error: 'edit needs a parent node with an image (sourceImage)' });
      const srcBuf = core.images.read(String(srcHash));
      const srcMeta = await sharp(srcBuf).metadata();
      if (!srcMeta.width || !srcMeta.height) return reply.status(400).send({ error: 'source image unreadable' });
      return runCropNode({
        parentId: cropParentId,
        fmt,
        srcHash: String(srcHash),
        srcBuf,
        srcSize: { width: srcMeta.width, height: srcMeta.height },
      });
    }

    const engine = engines.get(String(engineId));
    if (!engine) return reply.status(400).send({ error: `unknown engine ${engineId}` });
    const avail = await engine.isAvailable();
    if (!avail.ok) return reply.status(400).send({ error: avail.reason ?? 'engine unavailable' });
    if (kind !== 'generation' && kind !== 'edit')
      return reply.status(400).send({ error: 'kind must be generation|edit' });

    // A null parent would create a node the tree UI can never reach — anchor
    // parentless requests to the project root instead.
    const rootNode = core.store.rootFor(project.id);
    if (!rootNode) return reply.status(500).send({ error: 'project has no root node' });
    const resolvedParentId = parentId ? String(parentId) : rootNode.id;

    const ctx = brandContext(core, project.brandId);

    // Structured brief path: one compiler decides prompt, attachments and size.
    let compiled: ReturnType<typeof compileBrief> | null = null;
    /** Identity borrowed from the shot being refined, and what it attached. */
    let inheritedTokens: BriefToken[] = [];
    /** For an edit: the one allocation of own plus inherited references. */
    let mergedEdit: ReturnType<typeof mergeEditAttachments> | null = null;
    let editScope: EditScope = 'global';
    let gradeOnlyAsk = false;
    let budgetSourceHash: string | undefined;
    let sentSize: { width: number; height: number } | undefined;
    /** Things the route itself needs to say, alongside whatever the compiler warned about. */
    const extraWarnings: string[] = [];
    /** Set when a refinement is growing the frame rather than changing the picture. */
    let expandPlan: ExpandPlan | null = null;
    // What the engine was actually shown for an expansion: the source's sent
    // size after crop assist and the budget fit, and the assist window when
    // one was taken. Recorded on the brief so the run can be read back.
    let expandSent: { width: number; height: number } | null = null;
    let expandAssist: { width: number; height: number } | null = null;
    // The exact buffer the plan's offsets refer to — assisted and fitted —
    // which is what a real outpainter's answer is composited against. The
    // stored original is untouched and editedFrom keeps the true hash.
    let expandWorkHash: string | null = null;
    /** The bed handed to the engine, kept so the original can be laid back over its answer. */
    let expandSourceHash: string | null = null;
    if (brief && Array.isArray(brief.tokens)) {
      const briefErrors = validateBrief(brief);
      if (briefErrors.length) return reply.status(400).send({ error: `invalid brief: ${briefErrors.join('; ')}` });
      if (kind === 'edit') {
        // A refinement borrows the identity of the shot it refines, through
        // the same helper the preview route uses — one path, one truth.
        const edit = await compileEditBrief(project.brandId, resolvedParentId, brief as Brief, engine.capabilities(), {
          reshape,
        });
        compiled = edit.compiled;
        inheritedTokens = edit.inheritedTokens;
        mergedEdit = edit.merged;
        editScope = edit.editScope;
        // A pure-grade global ask ships the original's pixels wearing the
        // model's grade (gradeTransfer); decided from the user's own words,
        // conservatively - anything naming a thing falls through unchanged.
        gradeOnlyAsk =
          editScope === 'global' &&
          isGradeOnlyInstruction(
            ((brief?.tokens as BriefToken[] | undefined) ?? [])
              .filter((t): t is Extract<BriefToken, { t: 'text' }> => t.t === 'text')
              .map((t) => t.v)
              .join(' '),
          );
        extraWarnings.push(...edit.warnings.filter((w) => !compiled?.warnings.includes(w)));
        // An explicit extension needs no prose: the instruction is the
        // expansion's own, and the user's words are only an optional direction.
        if (!compiled.prompt.trim() && reshape !== 'extend')
          return reply.status(400).send({ error: 'the prompt is empty' });
      } else {
        /*
         * The last link in the chain, and it must be last: it reads the roster
         * the presenter and product resolvers have finished assembling, and
         * leads every referenced presenter with a head-and-shoulders crop of
         * their own front frame.
         *
         * The reference frames are full-length by construction, so the face
         * arrives at roughly 105px while a tight portrait renders it at 450.
         * That is why four outputs of one brief came back with four different
         * jaws. See identityCrop for the measurement.
         */
        const brandJson = await brandJsonWithIdentityCrops(
          core,
          await brandJsonWithResolvedPresenters(
            core,
            templatesRoot,
            presenters,
            await brandJsonWithResolvedDemoProducts(
              core,
              templatesRoot,
              demoProducts,
              brandJsonWithCatalogProducts(core, project.brandId),
              brief.tokens,
            ),
            brief.tokens,
          ),
          ((brief.tokens as BriefToken[] | undefined) ?? [])
            .filter((t): t is Extract<BriefToken, { t: 'character' }> => t.t === 'character')
            .map((t) => t.id),
        );
        const sceneById = sceneFor(brandJson);
        compiled = compileBrief(brief as Brief, {
          brand: brandJson,
          images: core.images,
          wordsFor: shotWordsFor(core, project.brandId),
          engineCaps: engine.capabilities(),
          template: brief.templateId ? sceneById(String(brief.templateId)) : undefined,
          templateById: sceneById,
        });
        if (!compiled.prompt.trim()) return reply.status(400).send({ error: 'the prompt is empty' });
      }
    }

    // Legacy callers send loose prompt/templateId/productId instead of a
    // brief. There used to be a second, hand-written implementation of scene
    // framing and reference collection here, and it disagreed with the
    // compiler in ways that mattered: it attached EVERY product shot where
    // compileBrief attaches a bounded, role-tagged set, and it re-assembled
    // the scene prompt by hand. Two code paths meant two behaviours drifting
    // apart. Now the legacy shape is translated into tokens and run through
    // the one compiler, so there is exactly one definition of what a brief
    // means anywhere in the product.
    let finalPrompt = String(prompt ?? '');
    let referenceImages: string[] | undefined;
    let referenceRoles: ReferenceRole[] | undefined;
    if (!compiled && (productId || templateId)) {
      if (templateId && !sceneFor(core.store.getBrand(project.brandId)?.json)(String(templateId)))
        return reply.status(400).send({ error: `unknown template ${templateId}` });
      if (productId && !resolveLibraryProduct(core, project.brandId, String(productId)))
        return reply.status(400).send({ error: 'product not found in brand' });

      const legacyTokens: BriefToken[] = [
        ...(productId ? [{ t: 'product' as const, id: String(productId) }] : []),
        ...(templateId ? [{ t: 'template' as const, id: String(templateId) }] : []),
        ...(prompt ? [{ t: 'text' as const, v: String(prompt) }] : []),
      ];
      const legacyBrief: Brief = { tokens: legacyTokens, templateFields: templateFields ?? {} };
      const brandJson = await brandJsonWithResolvedPresenters(
        core,
        templatesRoot,
        presenters,
        await brandJsonWithResolvedDemoProducts(
          core,
          templatesRoot,
          demoProducts,
          brandJsonWithCatalogProducts(core, project.brandId),
          legacyTokens,
        ),
        legacyTokens,
      );
      compiled = compileBrief(legacyBrief, {
        brand: brandJson,
        images: core.images,
        wordsFor: shotWordsFor(core, project.brandId),
        engineCaps: engine.capabilities(),
        templateById: sceneFor(brandJson),
      });
      if (productId && !compiled.attachments.some((a) => a.role === 'product'))
        return reply.status(400).send({ error: 'product has no usable shots' });
      if (!compiled.prompt.trim()) return reply.status(400).send({ error: 'the prompt is empty' });
    }

    let estimate: number;
    let work: (
      signal: AbortSignal,
      onImage: OnImageLanded,
    ) => Promise<{ images: string[]; costUsd: number; raw?: unknown }>;
    // Only generations declare a target shape. An edit inherits the source
    // image's dimensions, so there is nothing to check it against.
    let expectShape: { width: number; height: number } | undefined;
    /** For an edit, which image of the parent run it was made from. */
    let editedFrom: string | null = null;
    /*
     * Growing a frame may be handed to a different engine than the one that
     * made the shot, so cost, the spend cap and the provenance badge all have
     * to follow the engine that actually ran rather than the one that was
     * asked for.
     */
    let runEngine = engine;
    let expandMethod: OutpaintMethod | null = null;
    /**
     * Which of the two assemblies won, filled in by the draw itself.
     *
     * Read back after the run so the log carries the node it belongs to: the
     * choice is the one thing about an expansion that is not visible from the
     * request, and the battery reads it to check the rule against the pictures.
     */
    let expandDecision: ExpandDecision | null = null;

    if (compiled) {
      finalPrompt = compiled.prompt;
      referenceImages = compiled.referenceImages;
      referenceRoles = compiled.attachments.map((a) => a.role);
      width = compiled.width;
      height = compiled.height;
    }

    if (kind === 'generation') {
      const cap = engine.capabilities().maxReferenceImages;
      // One clamp for the whole request: the engine count, the variation plan
      // and the node watchdog must agree on how many images were asked for.
      const wantedCount = Math.min(Math.max(1, Number(count)), 8);
      // An identity reference that cannot be transmitted is not a degraded
      // generation, it is a wrong one: the model invents a product or a face
      // and returns it with full confidence. Refuse instead. Style references
      // are different — losing one costs fidelity of mood, not of subject —
      // so only product/character losses are fatal here.
      // Two losses cannot be helped by words: a photo that does not exist,
      // and an engine that reads no images at all. A budget loss on an engine
      // that does read images is not one of them: the compiler carries that
      // identity's written spec, the composer has already said so on the
      // chip, and seats go out in the brief's order, so the user chose.
      const blind = engine.capabilities().maxReferenceImages === 0;
      const lostIdentity = engine.capabilities().placeholder
        ? []
        : (compiled?.dropped ?? []).filter((d) => d.essential && (d.reason === 'missing' || blind));
      if (lostIdentity.length) {
        // Two causes, two remedies: a photo that does not exist cannot be
        // fixed by choosing another engine, and a budget loss cannot be fixed
        // by re-adding a photo. Say the one the user can act on.
        const missing = lostIdentity.filter((d) => d.reason === 'missing');
        if (missing.length) {
          const names = joinNames(missing.map((d) => d.label));
          const kindWord = missing[0].role === 'product' ? 'product' : 'presenter';
          return reply.code(400).send({
            error: `${names} ${missing.length === 1 ? 'has' : 'have'} no usable photo, so the result would not be your ${kindWord}. Re-add ${missing.length === 1 ? 'its' : 'their'} photo, or remove ${names} from the brief.`,
          });
        }
        const names = joinNames(lostIdentity.map((d) => d.label));
        const kindWord = lostIdentity[0].role === 'product' ? 'product' : 'presenter';
        return reply.code(400).send({
          error: `${engine.capabilities().displayName} cannot carry enough reference images, so ${names} would be named in the prompt but never shown. The result would not be your ${kindWord}. Choose an engine that supports reference images, or remove ${names} from the brief.`,
        });
      }
      // Downscale reference copies to what the engine will actually read;
      // stored originals are untouched, engines with no cap get them as-is.
      const maxEdge = engine.capabilities().maxReferenceEdge;
      const keptRefs = referenceImages && cap > 0 ? referenceImages.slice(0, cap) : undefined;
      const sentRefs =
        keptRefs && maxEdge ? await Promise.all(keptRefs.map((p) => capReferenceEdge(core, p, maxEdge))) : keptRefs;
      const sentRoles = referenceRoles && cap > 0 ? referenceRoles.slice(0, cap) : (referenceRoles ?? []);
      // Dev-only transport manifest: which pictures ride, which did not and
      // why. The one line that answers "did the presenter's face reach the
      // engine" without re-deriving the compile by hand.
      if (process.env.SCENRI_DEBUG) {
        const sent: Record<string, number> = {};
        for (const r of sentRoles) sent[r] = (sent[r] ?? 0) + 1;
        app.log.info(
          {
            engine: engine.capabilities().id,
            cap,
            sent,
            dropped: (compiled?.dropped ?? []).map((d) => `${d.role}:${d.label} (${d.reason ?? 'budget'})`),
          },
          'reference transport',
        );
      }
      /*
       * One recipe, N photographs.
       *
       * The plan is built HERE, once, from the same compile every output
       * shares, and is never recomputed per image: the whole point of the set
       * contract is that nothing downstream may re-decide what the run is of.
       * It reads the roles that are actually being SENT, not the ones the
       * compiler produced, so a reference the engine cap forced out is never
       * locked in prose that no picture backs.
       *
       * The camera envelope comes from the user's own words rather than the
       * compiled prompt: a scene's prose routinely names a lens, and reading
       * that as "the direction chose the camera" would narrow every set built
       * on a descriptive scene. Same reasoning as shotSpecifiesCamera's
       * existing use against `sentence`.
       */
      const briefText = Array.isArray((brief as any)?.tokens)
        ? (brief as any).tokens
            .filter((t: any) => t?.t === 'text')
            .map((t: any) => String(t?.v ?? ''))
            .join(' ')
        : String(prompt ?? '');
      const variations = variationPlan(wantedCount, {
        hasPresenter: sentRoles.includes('character'),
        hasProduct: sentRoles.includes('product'),
        hasMark: sentRoles.includes('brand'),
        cameraFixed: shotSpecifiesCamera(briefText),
      });
      const genReq: GenerateRequest = {
        prompt: finalPrompt,
        brand: ctx,
        width: Number(width),
        height: Number(height),
        count: wantedCount,
        ...(sentRefs ? { referenceImages: sentRefs } : {}),
        ...(sentRoles.length && cap > 0 ? { referenceRoles: sentRoles } : {}),
        ...(variations.length ? { variations } : {}),
      };
      estimate = await engine.costEstimate(genReq);
      work = (signal, onImage) => engine.generate(genReq, signal, onImage);
      expectShape = { width, height };
    } else {
      const parent = core.store.getNode(resolvedParentId);
      const srcHash = (req.body as any).sourceImage ?? parent?.images[0];
      // Which image this refinement was actually made from. A run holds several,
      // and without this the answer was thrown away the moment the request was
      // served: the provenance badge, Compare and Try again all fell back to the
      // first image, so three quarters of the refinements of a four-variant run
      // pointed at a picture they had never touched.
      editedFrom = srcHash ? String(srcHash) : null;
      if (!srcHash || !core.images.has(String(srcHash)))
        return reply.status(400).send({ error: 'edit needs a parent node with an image (sourceImage)' });
      if (!engine.capabilities().supportsEdit)
        return reply.status(400).send({ error: 'engine does not support edits' });
      // The one allocation of own plus inherited references, already made by
      // compileEditBrief with the source frame holding a slot. Legacy briefs
      // (no structured tokens) have nothing to merge and ride referenceImages.
      const editRefs = mergedEdit
        ? mergedEdit.kept.map((a) => ({ path: core.images.pathFor(a.hash), role: a.role }))
        : (referenceImages ?? [])
            .map((path, i) => ({ path, role: referenceRoles?.[i] }))
            .slice(0, Math.max(0, engine.capabilities().maxReferenceImages - 1));
      // References only — never the source frame, which keeps its pixels.
      const editEdge = engine.capabilities().maxReferenceEdge;
      if (editEdge) for (const r of editRefs) r.path = await capReferenceEdge(core, r.path, editEdge);
      // The same dev-only transport manifest the generation path logs.
      if (process.env.SCENRI_DEBUG) {
        const sent: Record<string, number> = {};
        for (const r of editRefs) sent[String(r.role ?? 'reference')] = (sent[String(r.role ?? 'reference')] ?? 0) + 1;
        app.log.info(
          {
            engine: engine.capabilities().id,
            cap: Math.max(0, engine.capabilities().maxReferenceImages - 1),
            sourceFrame: true,
            sent,
            dropped: (mergedEdit?.dropped ?? []).map((d) => `${d.role}:${d.label} (${d.reason ?? 'budget'})`),
          },
          'reference transport',
        );
      }

      // The old comment here said an edit inherits the source's dimensions so
      // there was nothing to check against. The source IS the thing to check
      // against, and without the check a refinement returned 1402x1122 from an
      // 816x1024 frame and was stored, shown, and inherited by every later step.
      const srcBuf = core.images.read(String(srcHash));
      const srcMeta = await sharp(srcBuf).metadata();
      if (srcMeta.width && srcMeta.height) expectShape = { width: srcMeta.width, height: srcMeta.height };

      /**
       * A different shape asked of a finished shot is an expansion, not a new
       * shot. Changing the format used to start one from scratch, so a square
       * somebody liked came back as a different picture in 16:9. Here the
       * photograph is kept and only the margin is generated, which is the one
       * edit whose region is known exactly rather than inferred.
       *
       * "Different shape ASKED" is judged against the thread's nominal format,
       * not against delivered pixels: an engine that drifted the ratio used to
       * flip every later plain refine into a silent outpaint of its own drift.
       * See wantsImplicitReshape.
       */
      const parentFormat = (
        (parent?.brief as { tokens?: unknown } | null)?.tokens as Array<Record<string, unknown>> | undefined
      )?.find((t) => t?.t === 'format');
      const parentNominal =
        parentFormat && Number(parentFormat.w) > 0 && Number(parentFormat.h) > 0
          ? { width: Number(parentFormat.w), height: Number(parentFormat.h) }
          : null;
      // A shape is only an ask when the brief actually carries one. An edit
      // brief with no format token compiles at the DEFAULT canvas, and
      // reading that default as "please reshape to square" silently turned an
      // API caller's plain refine into an expansion with invented margins
      // (measured live: a 4:5 portrait came back as a square letterboxed in
      // black). The studio always sends the source's format token, so this
      // gate changes nothing it produces; it protects every other caller.
      const briefNamesShape = ((brief?.tokens as BriefToken[] | undefined) ?? []).some((t) => t?.t === 'format');
      const reshapeIntended =
        reshape === 'extend' ||
        (reshape === undefined &&
          briefNamesShape &&
          !!srcMeta.width &&
          !!srcMeta.height &&
          !!compiled?.width &&
          !!compiled?.height &&
          wantsImplicitReshape({ width: compiled.width, height: compiled.height }, parentNominal, {
            width: srcMeta.width,
            height: srcMeta.height,
          }));
      /*
       * The server classifies the reshape; the wire op is a hint. It used to
       * be the authority, and an absent op always meant extend — so an API
       * caller asking a 16:9 shot for 9:16 got a single pass growing one axis
       * 3.16x, which no engine on this path can draw. Now: an explicit crop
       * took the dedicated path above; an explicit extend is honoured inside
       * the growth bound and refused plainly outside it; an absent op falls
       * to the same geometry the composer preselects with, so caller and
       * server agree by construction.
       *
       * Crop assist and the budget fit both act on WORKING copies. The stored
       * original is never touched, and editedFrom keeps the true hash.
       */
      let workBuf = srcBuf;
      let workSize = srcMeta.width && srcMeta.height ? { width: srcMeta.width, height: srcMeta.height } : null;
      if (reshapeIntended && workSize && compiled?.width && compiled?.height) {
        const targetRatio = compiled.width / compiled.height;
        const decision = classifyReshape(workSize, targetRatio, reshape);
        if (decision.op === 'crop') {
          if (reshape === 'extend')
            return reply.status(400).send({
              error:
                `growing a ${workSize.width}x${workSize.height} frame to this shape would invent more of the ` +
                'photograph than it keeps; crop instead',
            });
          const fmt = ((brief?.tokens as BriefToken[] | undefined) ?? []).find(
            (t): t is Extract<BriefToken, { t: 'format' }> => t.t === 'format' && Number(t.w) > 0 && Number(t.h) > 0,
          );
          if (fmt)
            return runCropNode({
              parentId: resolvedParentId,
              fmt,
              srcHash: String(srcHash),
              srcBuf,
              srcSize: workSize,
              note: decision.forced
                ? 'That shape is further than one extend can reach, so the picture was cropped to it instead.'
                : undefined,
            });
        } else if (decision.op === 'extend') {
          if (decision.assist) {
            /*
             * Crop assist: growth past the bound gives up a capped slice of
             * the axis that is not growing, so the engine invents less and
             * the photograph keeps more of its resolution under the budget
             * fit below. Centred by design — placement decides where the
             * picture sits, and a crop that also moved the subject would be
             * two decisions wearing one name (see outpaint/growth.ts).
             */
            expandAssist = { width: decision.assist.width, height: decision.assist.height };
            workBuf = await sharp(srcBuf).extract(decision.assist).png().toBuffer();
            workSize = { width: decision.assist.width, height: decision.assist.height };
          }
          expandPlan = planExpand(workSize, targetRatio);
        }
      }
      // An explicit extend with nothing to extend into is a caller mistake,
      // not a silent plain edit with an empty instruction.
      if (reshape === 'extend' && !expandPlan)
        return reply.status(400).send({ error: 'the picture is already this shape' });
      /*
       * Where the picture sits in the frame it grew into.
       *
       * planExpand centres unconditionally, which is the open finding from the
       * August marathon: Scenri adapts the box, not the picture. Keeping the
       * subject at the relative position it already held costs nothing, moves
       * no source pixel, and stops a bottle composed against one edge from
       * landing in the middle of a frame it was never shot for.
       */
      if (expandPlan && workSize) {
        expandPlan = placeExpand(expandPlan, workSize, await subjectFraction(workBuf, workSize, expandPlan.axis));
      }
      /*
       * A real outpainter wants the PICTURE and where it sits; everything else
       * gets the bed, because it is going to re-render the whole frame and the
       * bed is the only way to tell it what the margin should look like.
       *
       * The margin may go to a different engine than the shot did. An extend
       * needs no identity references, because the Product and the Presenter sit
       * inside the protected region and are composited back untouched, so the
       * usual reason never to switch provider does not apply.
       */
      if (expandPlan) {
        const route = await resolveOutpaintRoute(engines.all(), engine);
        runEngine = route.engine;
        expandMethod = route.method;
      }
      const canOutpaint = expandMethod === 'outpaint';
      /*
       * The frame is planned at the engine's own pixel budget, never above
       * it. This is the fix for the reshape mush: a 1122x1402 shot asked for
       * 16:9 used to plan a 2496x1402 frame — 2.2x what codex can draw — and
       * the engine's native answer was then upscaled to fill it, soft margins
       * against a sharp centre on the composite arm and a globally resampled
       * photograph on the reframe arm. Fitting the whole geometry down once,
       * uniformly, by our lanczos, makes the ask, the prompt's stated size
       * and the assembly frame the same numbers: the exact-size branch fires
       * and nothing on the path is upscaled. The preserved centre may carry
       * less linear resolution when the geometry forces it, and the warning
       * below says so rather than faking pixels the engine never drew.
       */
      if (expandPlan && workSize) {
        const fit = fitExpandToBudget(expandPlan, workSize, runEngine.capabilities().editPixelBudget);
        if (fit.scale < 1) {
          expandPlan = fit.plan;
          workBuf = await sharp(workBuf)
            .resize(fit.source.width, fit.source.height, { fit: 'fill', kernel: 'lanczos3' })
            .png()
            .toBuffer();
          workSize = fit.source;
          extraWarnings.push(
            `${runEngine.capabilities().displayName} draws about ${((runEngine.capabilities().editPixelBudget ?? 0) / 1_000_000).toFixed(1)} megapixels, ` +
              `so this shape continues as a ${fit.plan.width}x${fit.plan.height} frame with the photograph riding inside it at ${fit.source.width}x${fit.source.height}. ` +
              'Nothing is upscaled; the stored size is the size the engine truly drew.',
          );
        }
        expandSent = workSize;
      }
      /*
       * The route with no mask draws twice, and the two draws are shown
       * different things on purpose.
       *
       * The BED is the picture magnified to fill the new frame and blurred,
       * with the sharp original laid back on top. Handed that and told to
       * change only the margin, the model leaves the middle alone almost
       * exactly, which is what makes the original safe to composite back over
       * its answer. The PADDED frame is the picture at its own scale with the
       * new area carrying nothing but its own border colours, which tells no
       * lie about texture scale and is what a coherent whole frame is drawn
       * from.
       *
       * Neither is better everywhere. Which one ships is decided per shot,
       * after both have been assembled and the join measured — see
       * outpaint/choose.ts.
       */
      let reframeSourceHash: string | undefined;
      if (expandPlan) {
        if (!canOutpaint) {
          expandSourceHash = core.images.save(await expandCanvas(workBuf, expandPlan));
          reframeSourceHash = core.images.save(await conditioningCanvas(workBuf, expandPlan, 'edge'));
        } else {
          // A real outpainter is sent the working copy itself, and its answer
          // is composited against that same buffer in post.
          expandWorkHash = core.images.save(workBuf);
        }
        expectShape = { width: expandPlan.width, height: expandPlan.height };
      }

      /*
       * A fixed-budget engine cannot answer an over-budget source at its own
       * size. Sending the full frame made the tool downscale it invisibly,
       * and the old resize-back then inflated the answer to a size its pixels
       * could not fill - on every hop. The source now steps down ONCE,
       * deterministically (our lanczos, not the model's resample), the ask
       * and the answer become the same numbers, and every later hop is scale
       * 1.0. The stored original is untouched and editedFrom keeps the true
       * hash; enforceEditCanvas accepts the native answer and records the
       * step-down on the brief. Local-scope edits still composite at the
       * original's size, so their untouched pixels never shrink.
       */
      const editPixelBudget = runEngine.capabilities().editPixelBudget;
      // A frame a few pixels over the budget steps down to its own size; that
      // is no step at all, so neither the resample nor the note happens.
      const stepped =
        !expandPlan &&
        editPixelBudget &&
        srcMeta.width &&
        srcMeta.height &&
        srcMeta.width * srcMeta.height > editPixelBudget
          ? budgetSize(srcMeta.width, srcMeta.height, editPixelBudget)
          : null;
      if (editPixelBudget && stepped && (stepped.width !== srcMeta.width || stepped.height !== srcMeta.height)) {
        sentSize = stepped;
        budgetSourceHash = core.images.save(
          await sharp(srcBuf)
            .resize(sentSize.width, sentSize.height, { fit: 'fill', kernel: 'lanczos3' })
            .png()
            .toBuffer(),
        );
        // A grade-only ask usually ends at the ORIGINAL's own size (the
        // composite grades the original, not the engine's frame), so the
        // step-down note would be a lie there; when the evidence gate falls
        // through to the engine's frame, the accept verdict still records
        // steppedDown on the brief.
        if (!gradeOnlyAsk)
          extraWarnings.push(
            `${runEngine.capabilities().displayName} refines at about ${(editPixelBudget / 1_000_000).toFixed(1)} megapixels, ` +
              `so this ${srcMeta.width}x${srcMeta.height} frame continues at ${sentSize.width}x${sentSize.height} from here on. ` +
              'The picture is unchanged; the stored size is now the size the engine truly drew.',
          );
      }

      const editReq: EditRequest = {
        instruction: expandPlan ? expandInstruction(expandPlan, finalPrompt) : finalPrompt,
        sourceImage: core.images.pathFor(String(expandSourceHash ?? expandWorkHash ?? budgetSourceHash ?? srcHash)),
        brand: ctx,
        ...(editRefs.length ? { referenceImages: editRefs.map((r) => r.path) } : {}),
        ...(editRefs.length ? { referenceRoles: editRefs.map((r) => r.role ?? 'reference') } : {}),
        // An answer at the planned size lets compositeExpand skip its rescale,
        // which is one whole class of seam misalignment gone when honored. A
        // plain refine states the source's own pixels for the same reason:
        // engines given no size answered at whatever size they liked, the
        // shrunken answer was stored, and the next refinement inherited it —
        // the chain that walked shots down to thumbnails.
        ...(expandPlan
          ? { width: expandPlan.width, height: expandPlan.height }
          : sentSize
            ? sentSize
            : srcMeta.width && srcMeta.height
              ? { width: srcMeta.width, height: srcMeta.height }
              : {}),
        // Only an engine that can genuinely paint a margin is told where the
        // picture sits; the rest would ignore it anyway.
        ...(expandPlan && canOutpaint
          ? {
              expand: {
                left: expandPlan.left,
                top: expandPlan.top,
                // The sent copy's own size: after crop assist and the budget
                // fit these are the pixels the offsets actually refer to.
                width: workSize?.width ?? srcMeta.width ?? 0,
                height: workSize?.height ?? srcMeta.height ?? 0,
              },
              // Derived from the picture and the shape asked for, so the same
              // extend of the same shot is the same picture every time. Without
              // it the margin is a fresh roll of the dice on every run, which
              // is not something a person can iterate against — or that a test
              // can measure.
              seed: seedFor(String(editedFrom ?? srcHash), expandPlan.width, expandPlan.height),
            }
          : {}),
      };
      estimate = await runEngine.costEstimate(editReq);
      /*
       * An expansion with no mask is drawn twice, at once, and the frame that
       * ships is chosen after both have been assembled.
       *
       * This used to be two identical draws ranked by their join, because the
       * default engine has no seed and the same request came back at 2.8, then
       * 15.1, then 2.1. Two draws still cost one wall clock, but ranking two
       * tries of the same idea only ever buys the luckier roll. The battery of
       * 2026-08-26 measured something better to spend the second draw on.
       *
       * The two candidates fail in opposite directions. Compositing the
       * original back is exact by construction and sometimes shows a join —
       * measured invisible on five of six shots and 7.65 on the sixth, against
       * a threshold of 2.2. Keeping the model's own frame has no join to show
       * and is no longer exactly the photograph. So the choice is made per
       * shot, on evidence, rather than fixed in advance: exact pixels whenever
       * they cost nothing visible, and only otherwise given up.
       *
       * An engine that paints margins properly is still asked once, because its
       * answer is not a lottery and its middle was never at risk.
       */
      const plan = expandPlan;
      // The composite pastes the copy the plan was made for: assisted and
      // budget-fitted. Against anything else the offsets would lie.
      const srcSize = workSize ?? { width: srcMeta.width ?? 0, height: srcMeta.height ?? 0 };
      const original = workBuf;
      const reframeReq: EditRequest | null =
        plan && !canOutpaint && reframeSourceHash
          ? {
              ...editReq,
              instruction: reframeInstruction(plan, srcSize, finalPrompt),
              sourceImage: core.images.pathFor(reframeSourceHash),
            }
          : null;
      work =
        plan && !canOutpaint && reframeReq
          ? async (signal) => {
              // Either draw may die on its own — a codex run times out around
              // one time in eight — and one survivor is still a whole answer,
              // because the two are alternatives rather than halves. Only a
              // pair of failures is a failure, and then the engine's own error
              // is what surfaces rather than a manufactured one.
              const [bedDraw, paddedDraw] = await Promise.allSettled([
                runEngine.edit(editReq, signal),
                runEngine.edit(reframeReq, signal),
              ]);
              const bed = bedDraw.status === 'fulfilled' ? bedDraw.value : null;
              const padded = paddedDraw.status === 'fulfilled' ? paddedDraw.value : null;
              if (!bed && !padded) {
                throw bedDraw.status === 'rejected' ? bedDraw.reason : (paddedDraw as PromiseRejectedResult).reason;
              }

              /*
               * The original composited back over BOTH answers, not just the
               * bed's. Every composite is byte-for-byte exact in the middle, so
               * they differ only in how well the margin meets the picture — and
               * the two conditionings disagree about which shots they can carry.
               * On the hardest one the bed answer joins at 7.65 and the padded
               * answer at 1.68, so compositing only the bed would surrender a
               * photograph that did not need surrendering. A second local
               * composite costs no draw and no quota.
               */
              const preserved: PreservedCandidate[] = [];
              for (const [from, draw] of [
                ['bed', bed],
                ['padded', padded],
              ] as const) {
                const hash = draw?.images[0];
                if (!hash) continue;
                const { image } = await compositeExpand(core.images.read(hash), original, plan);
                const [score, residual] = await Promise.all([
                  seamScore(image, plan, srcSize),
                  seamResidual(image, plan, srcSize),
                ]);
                preserved.push({ image, seam: seamPenalty(score, residual), from });
              }

              // The model's own frame, only ever resized to the planned pixels.
              // The fallback for the shot where neither composite can carry it.
              let reframed: { image: Buffer } | null = null;
              const paddedImage = padded?.images[0];
              if (paddedImage) {
                const frame = await reframeExpand(core.images.read(paddedImage), plan);
                if (frame) reframed = { image: frame };
              }

              const decision = chooseExpand({ preserved, reframed });
              // Both draws returned, and neither could be assembled into a
              // frame: let the engine's own answer stand and be reported as
              // whatever it is, rather than inventing a result for it.
              if (!decision) return (bed ?? padded) as EngineResult;
              expandDecision = decision;
              return {
                images: [core.images.save(decision.image)],
                costUsd: (bed?.costUsd ?? 0) + (padded?.costUsd ?? 0),
              };
            }
          : (signal) => runEngine.edit(editReq, signal);
    }

    // throws 402 via handler; include estimates of everything still in flight
    const billedId = runEngine.capabilities().id;
    core.ledger.assertUnderCap(billedId, estimate + (reserved.get(billedId) ?? 0));
    // One image, one node: a multi-shot generation lands as N sibling nodes
    // sharing one engine call, one recipe and one batch identity. An edit is
    // always a single node.
    const nodes =
      kind === 'generation'
        ? core.store.addNodes({
            projectId: project.id,
            parentId: resolvedParentId,
            kind,
            prompt: finalPrompt,
            engineId: billedId,
            // the same clamp the engine request and the watchdog use
            count: Math.min(Math.max(1, Number(count)), 8),
          })
        : [
            core.store.addNode({
              projectId: project.id,
              parentId: resolvedParentId,
              kind,
              prompt: finalPrompt,
              engineId: billedId,
            }),
          ];
    const node = nodes[0];
    // the resolved source rides along in the brief, which is already a JSON
    // blob on the node, so the record needs no new column to be accurate —
    // and so does the reshape op, when one was asked for by name. Every
    // sibling carries the same recipe: the batch shares one compile.
    for (const sibling of brief ? nodes : [])
      core.store.setBrief(sibling.id, {
        ...briefInputsOnly(brief as object),
        ...(editedFrom ? { sourceImage: editedFrom } : {}),
        ...(kind === 'edit' && reshape ? { reshape } : {}),
        // How the margin was actually made, and by whom. An extend may be
        // handed to a different engine than the shot used, and a record that
        // does not say so cannot be read back later.
        ...(expandMethod && expandPlan
          ? {
              expand: {
                method: expandMethod,
                engineId: billedId,
                // Where the protected picture sits in the frame it grew into.
                // Placement is no longer always centred, so a reader that
                // assumes it is would be looking in the wrong place.
                left: expandPlan.left,
                top: expandPlan.top,
                // The planned frame and the size the photograph was sent at,
                // so requested-versus-drawn is a readable fact — and the
                // assist window when a slice of the other axis was given up.
                frame: [expandPlan.width, expandPlan.height],
                ...(expandSent ? { source: [expandSent.width, expandSent.height] } : {}),
                ...(expandAssist ? { assist: [expandAssist.width, expandAssist.height] } : {}),
              },
            }
          : {}),
        // What the refinement carried, recorded apart from what it asked for:
        // the detail view shows both, and reuse setup merges both (mergeCarried).
        ...(kind === 'edit' && inheritedTokens.length ? { inherited: inheritedTokens } : {}),
      });
    // Fire and forget: the 202 is the answer and the node's own status carries
    // the outcome. runNode records failures itself, so a rejection here means
    // even that failed — log it, but never let it reach the process unhandled.
    // Expansion takes its guarantee rather than asking for it: whatever the
    // engine returns supplies the margin, and the original photograph is laid
    // back over it at the offset it was planned into, byte for byte.
    const plan = expandPlan;
    // editedFrom is the resolved source, which may have come from the parent
    // rather than from the request body.
    const original = editedFrom ? core.images.read(editedFrom) : null;
    /**
     * A targeted change keeps the rest of the photograph, by measuring what
     * actually moved and pasting the original back around it. The engine is
     * asked to leave the rest alone and mostly does, but mostly is not a
     * guarantee, and the evidence gets its own vote: an edit that turns out to
     * have moved half the frame is stored as the re-render it evidently was.
     */
    const localScope = kind === 'edit' && !plan && editScope === 'local' && original;
    /**
     * The canvas contract for a plain refinement: a same-shape answer at a
     * drifted size is resampled back onto the exact source canvas, and an
     * answer below the floor fails the node. Runs after the local-scope
     * composite (whose composited output is already at source size and passes
     * through untouched) and before assertAspect. See editSizeRules.
     */
    const enforceEditCanvas = async (images: string[]): Promise<string[]> => {
      const srcMeta = await sharp(original!).metadata();
      if (!srcMeta.width || !srcMeta.height) return images;
      const out: string[] = [];
      for (const h of images) {
        const meta = await sharp(core.images.read(h)).metadata();
        const got = { width: meta.width ?? 0, height: meta.height ?? 0 };
        const verdict = judgeEditSize({ width: srcMeta.width, height: srcMeta.height }, got, {
          pixelBudget: runEngine.capabilities().editPixelBudget,
        });
        if (verdict.action === 'accept') {
          // The engine's own native answer to an over-budget source: kept
          // as-is, never inflated back into pixels it never drew. The thread
          // steps down once; the next hop is scale 1.0. Recorded apart from
          // resampledHops, because nothing was resampled.
          app.log.info(
            { nodeId: node.id, got: `${got.width}x${got.height}`, src: `${srcMeta.width}x${srcMeta.height}` },
            'edit: kept the engine-native answer (pixel-budget step-down)',
          );
          try {
            const fresh = core.store.getNode(node.id);
            const b = (fresh?.brief as object | null) ?? {};
            core.store.setBrief(node.id, { ...b, steppedDown: [srcMeta.width, srcMeta.height] });
          } catch {
            /* the record is a convenience; failing to write it must not fail the run */
          }
          out.push(h);
          continue;
        }
        if (verdict.action === 'reject')
          throw new Error(
            `engine returned ${got.width}x${got.height} for a ${srcMeta.width}x${srcMeta.height} frame: ` +
              'too little of the picture came back to keep at this resolution',
          );
        if (verdict.action === 'resize') {
          app.log.info(
            { nodeId: node.id, got: `${got.width}x${got.height}`, want: `${srcMeta.width}x${srcMeta.height}` },
            'edit: normalized the answer to the source canvas',
          );
          out.push(
            core.images.save(
              await sharp(core.images.read(h)).resize(srcMeta.width, srcMeta.height, { fit: 'fill' }).png().toBuffer(),
            ),
          );
          // What the engine actually answered with, next to the sizes runNode
          // records after this - and a resample counter carried down the
          // thread, so "hop five is mush" is a readable fact instead of an
          // eyeball claim. Every hop's pixels are freshly generated, so the
          // counter measures exposure, not accumulation on one image.
          try {
            const fresh = core.store.getNode(node.id);
            const b = (fresh?.brief as object | null) ?? {};
            const parentBrief = (core.store.getNode(resolvedParentId)?.brief ?? {}) as {
              resampledHops?: number;
            };
            core.store.setBrief(node.id, {
              ...b,
              resizedFrom: [got.width, got.height],
              resampledHops: (parentBrief.resampledHops ?? 0) + 1,
            });
          } catch {
            /* the record is a convenience; failing to write it must not fail the run */
          }
        } else out.push(h);
      }
      return out;
    };
    /*
     * Only a real outpainter's answer is composited here. The route with no
     * mask assembled and chose inside the draw itself, because the choice needs
     * both candidates in hand and only one of them survives into the result.
     */
    const post = plan
      ? expandMethod === 'outpaint'
        ? async (images: string[]) => {
            const out: string[] = [];
            for (const h of images) {
              const answer = core.images.read(h);
              // The battery reads this to measure how often the engine honors
              // the exact-size request; a match means no rescale at all.
              const got = await sharp(answer).metadata();
              if (got.width !== plan.width || got.height !== plan.height)
                app.log.info(
                  { nodeId: node.id, got: `${got.width}x${got.height}`, want: `${plan.width}x${plan.height}` },
                  'expand: engine size differs from plan',
                );
              // The pasted copy is the one the plan's offsets refer to: the
              // assisted, budget-fitted buffer the engine was sent — not the
              // stored original, whose size the plan no longer describes.
              const pasted = expandWorkHash ? core.images.read(expandWorkHash) : original!;
              const { image, aligned } = await compositeExpand(answer, pasted, plan);
              if (!aligned) app.log.warn({ nodeId: node.id }, 'expand: engine frame did not align, kept the bed');
              out.push(core.images.save(image));
            }
            return out;
          }
        : async (images: string[]) => {
            if (expandDecision)
              app.log.info(
                {
                  nodeId: node.id,
                  choice: expandDecision.choice,
                  reason: expandDecision.reason,
                  seam: expandDecision.seam,
                  from: expandDecision.from,
                },
                'expand: chose which frame to keep',
              );
            return images;
          }
      : kind === 'edit' && original
        ? async (images: string[]) => {
            let staged = images;
            if (gradeOnlyAsk && !expandPlan) {
              // A pure-grade ask ships the photograph's own pixels wearing
              // the model's grade: texture, skin and resolution are frozen
              // from the shot the user approved, so a chain of tonal
              // refinements loses nothing, however long it runs. The model's
              // frame ships only when its answer was more than a grade.
              const sent = budgetSourceHash ? core.images.read(budgetSourceHash) : original;
              const out: string[] = [];
              for (const h of staged) {
                const g = await gradeComposite(original, sent, core.images.read(h));
                if (g) {
                  app.log.info(
                    { nodeId: node.id, residual: Number(g.residual.toFixed(2)) },
                    'edit: shipped the original pixels wearing the grade',
                  );
                  out.push(core.images.save(g.image));
                  try {
                    const fresh = core.store.getNode(node.id);
                    core.store.setBrief(node.id, { ...((fresh?.brief as object | null) ?? {}), gradeComposited: true });
                  } catch {
                    /* the record is a convenience; failing to write it must not fail the run */
                  }
                } else out.push(h);
              }
              staged = out;
            }
            if (localScope) {
              const out: string[] = [];
              for (const h of staged) {
                const { image, outcome, changed } = await preserveOutsideChange(original, core.images.read(h));
                app.log.info({ nodeId: node.id, outcome, changed }, 'local edit');
                out.push(outcome === 'composited' ? core.images.save(image) : h);
              }
              staged = out;
            } else if (expectShape) {
              // A global refine whose answer drifted shape is conformed by an
              // attention crop first, so the canvas pass below sees a
              // same-shape frame and finishes the job with one uniform
              // lanczos. Local scope stays strict: a targeted edit that came
              // back a different shape has failed its brief, and cropping it
              // would quietly void the outside-preservation guarantee.
              staged = await conformToCanvas(node.id, expectShape)(staged);
            }
            return enforceEditCanvas(staged);
          }
        : undefined;
    // Per-node post: an edit's guarantee pipeline is bound to its one node; a
    // generation's canvas conformance is bound to whichever sibling it is
    // conforming, so cropping provenance lands on the right record instead of
    // the last-conformed image overwriting everyone's.
    const genW = compiled?.width;
    const genH = compiled?.height;
    const postFor =
      post !== undefined
        ? () => post
        : kind === 'generation' && genW && genH
          ? (id: string) => conformToCanvas(id, { width: genW, height: genH })
          : undefined;
    /*
     * A generation that fans out per image is bounded by its WAVE COUNT, not by
     * a flat ten minutes: eight codex variants are four 300s waves, and four
     * sequential openrouter calls are four calls' worth of time.
     *
     * Declared by the engine rather than named here, because the alternative
     * was a chain of engine ids in the server. An engine that hands the count
     * to the provider in one call declares nothing and keeps the default: it
     * only ever makes one request, so there is no later image to starve.
     */
    const runCaps = runEngine.capabilities();
    const nodeBudgetMs =
      kind === 'generation' && runCaps.perImageTimeoutMs
        ? Math.ceil(Math.min(Math.max(1, Number(count)), 8) / Math.max(1, runCaps.imageConcurrency ?? 1)) *
            runCaps.perImageTimeoutMs +
          60_000
        : undefined;
    void runNode(
      nodes.map((n) => n.id),
      runEngine,
      estimate,
      work,
      expectShape,
      postFor,
      nodeBudgetMs,
    ).catch((err) => app.log.error({ err }, 'node run failed'));
    // Surface the compiler's warnings on the accepted node. These name real
    // fidelity risks — a scene built around a product with none attached, an
    // asset that vanished, a reference the engine could not carry — and were
    // previously computed and then dropped, visible only in the preview call.
    // A caller that skipped preview had no way to learn its brief was degraded.
    // The first node is spread so every `.id` reader keeps working; the full
    // batch rides beside it for callers that care about the siblings.
    const allWarnings = [...(compiled?.warnings ?? []), ...extraWarnings];
    return reply
      .status(202)
      .send({ ...node, siblings: nodes, ...(allWarnings.length ? { warnings: allWarnings } : {}) });
  });

  app.post('/api/nodes/:id/cancel', async (req, reply) => {
    const id = (req.params as any).id;
    const n = core.store.getNode(id);
    if (!n) return reply.status(404).send({ error: 'node not found' });
    const ctrl = runningGenerations.get(id);
    if (!ctrl) return reply.status(400).send({ error: 'not running' });
    ctrl.abort();
    return { ok: true };
  });

  app.get('/api/nodes/:id', async (req, reply) => {
    const n = core.store.getNode((req.params as any).id);
    return n ?? reply.status(404).send({ error: 'node not found' });
  });
  app.put('/api/nodes/:id/overlays', async (req, reply) => {
    const n = core.store.getNode((req.params as any).id);
    if (!n) return reply.status(404).send({ error: 'node not found' });
    const overlays = (req.body as any)?.overlays;
    if (typeof overlays !== 'object' || overlays === null || Array.isArray(overlays)) {
      return reply.status(400).send({ error: 'overlays must be an object keyed by image index' });
    }
    for (const v of Object.values(overlays)) {
      if (!Array.isArray(v)) return reply.status(400).send({ error: 'each overlay entry must be a layer array' });
    }
    if (JSON.stringify(overlays).length > 200_000) return reply.status(400).send({ error: 'overlays too large' });
    core.store.setOverlays(n.id, overlays);
    return core.store.getNode(n.id);
  });
  app.post('/api/nodes/:id/keep', async (req, reply) => {
    const n = core.store.getNode((req.params as any).id);
    if (!n) return reply.status(404).send({ error: 'node not found' });
    core.store.setKept(n.id, Boolean((req.body as any)?.kept ?? true));
    // the list shape: what the feed patches in place, without a re-read
    return core.store.getFeedNode(n.id);
  });
  app.post('/api/nodes/:id/archive', async (req, reply) => {
    const n = core.store.getNode((req.params as any).id);
    if (!n) return reply.status(404).send({ error: 'node not found' });
    core.store.setArchived(n.id, Boolean((req.body as any)?.archived ?? true));
    return core.store.getFeedNode(n.id);
  });
  // permanent — the client already restricts this to the Archived lens, but
  // the archived-only rule is enforced here too, not just in the UI
  app.delete('/api/nodes/:id', async (req, reply) => {
    const n = core.store.getNode((req.params as any).id);
    if (!n) return reply.status(404).send({ error: 'node not found' });
    if (!n.archived) return reply.status(400).send({ error: 'archive this shot before deleting it' });
    core.store.deleteNode(n.id);
    return { ok: true };
  });
  app.post('/api/nodes/delete-batch', async (req, reply) => {
    const ids = (req.body as any)?.nodeIds;
    if (!Array.isArray(ids) || ids.length === 0) return reply.status(400).send({ error: 'nodeIds required' });
    let deleted = 0;
    for (const id of ids) {
      const n = core.store.getNode(id);
      if (n?.archived) {
        core.store.deleteNode(id);
        deleted++;
      }
    }
    return { ok: true, deleted };
  });

  registerImageRoutes(app, { core, thumbs });

  // ---- this machine: where the work lives, and how to get it all out
  // ---- version + lifecycle
  const runtime = opts.runtime ?? { installKind: 'unknown' as const, supervised: false };
  const updates = createUpdateChecker({ name: meta.name, store: core.store, fetchImpl: opts.fetchImpl });
  app.decorate('updates', updates);
  app.decorate('content', createContentFetcher({ store: core.store, fetchImpl: opts.fetchImpl }));
  registerUpdateRoutes(app, {
    core,
    meta,
    updates,
    runtime,
    stageImpl: opts.stageImpl,
    exitImpl: opts.exitImpl,
    // one physical run counts once, however many sibling nodes share its
    // controller — an update gate held open by a 4-shot batch is still held
    // open by exactly one piece of work
    busyCount: () => new Set(runningGenerations.values()).size + runningImportCount() + runningAssetBuildCount(),
  });

  // Settle in-flight work before the process goes away (Ctrl-C, update
  // restart). Abort is the same path the cancel button takes, so every node
  // lands in 'cancelled' with its reservation released — never in the crash
  // sweep's 'interrupted' bucket.
  let drained: Promise<void> | null = null;
  app.decorate('drain', (): Promise<void> => {
    drained ??= (async () => {
      for (const ctrl of runningGenerations.values()) ctrl.abort();
      const deadline = Date.now() + 5000;
      while (runningGenerations.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await thumbs.settle();
      await app.close();
      core.close();
    })();
    return drained;
  });

  registerSystemRoutes(app, { core, thumbs });
  registerDesktopRoutes(app, {
    core,
    runtime,
    exitImpl: opts.exitImpl,
    busyCount: () => new Set(runningGenerations.values()).size + runningImportCount() + runningAssetBuildCount(),
  });

  // ---- studio SPA
  if (opts.studioDist && existsSync(opts.studioDist)) {
    // wildcard route resolves files per request, so a rebuilt dist (new asset
    // hashes) serves without restarting the server. index.html is read per
    // request for the same reason.
    const dist = opts.studioDist;
    app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) return reply.status(404).send({ error: 'not found' });
      // index.html names content-hashed asset files, so a browser that caches
      // it is pinned to whichever bundle it first saw — a rebuild then never
      // reaches that tab, silently. Without an explicit header browsers apply
      // heuristic caching to a 200 with no cache-control, which is exactly that
      // failure. The hashed assets under /assets stay immutable; only this
      // pointer has to revalidate.
      reply
        .header('content-type', 'text/html')
        .header('cache-control', 'no-cache, must-revalidate')
        .send(readFileSync(`${dist}/index.html`, 'utf8'));
    });
  }

  return app;
}
