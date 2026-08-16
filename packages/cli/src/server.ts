import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadScenes, sceneResolver, facetsOf, defaultScenesDir, type Scene } from './scenes.js';
import {
  brandJsonWithResolvedPresenters,
  loadPresenters,
  presenterFacetsOf,
  presenterAvatarPath,
  presenterRefPath,
  type Presenter,
} from './presenters.js';
import {
  brandJsonWithResolvedDemoProducts,
  loadDemoProducts,
  demoProductFacetsOf,
  demoProductResolver,
  demoProductRefPath,
  PRODUCT_ANGLES_BY_CATEGORY,
  primaryAngleFor,
  type DemoProduct,
} from './demoProducts.js';
import { loadShowcase, showcaseFacetsOf, type ShowcaseEntry } from './showcase.js';
import { brandRuleDirectives, compileBrief, validateBrief, FORMATS, type Brief, type BriefToken } from './brief.js';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';
import { basename, join } from 'node:path';
import type { Core, EngineAdapter, GenerateRequest, EditRequest, BrandContext, ReferenceRole } from '@scenri/core';
import { SpendCapError, ASPECT_TOLERANCE, SCHEMA_VERSION } from '@scenri/core';
import { readMeta, repoSlug } from './meta.js';
import { classify, createUpdateChecker, type UpdateChecker } from './update/check.js';
import { RELEASES, isNewsworthy, releaseFor } from './release/notes.data.js';
import { findNpm, stageVersion } from './update/stage.js';
import { compareSemver, newestStaged } from './update/versionsDir.js';
import { validateBrand, buildFromUrl, mergeScrape } from '@scenri/brand';
import type { EngineRegistry } from './engines.js';
import { driftDiff } from './diff.js';
import { vibrantColor } from './swatch.js';
import { buildExportZip, EXPORT_PRESETS } from './exportPack.js';
import { buildBrandBundle } from './exportBrand.js';
import {
  startCatalogImport,
  cancelCatalogImport,
  brandJsonWithCatalogProducts,
  resolveLibraryProduct,
  runningImportCount,
} from './catalogImport.js';
import {
  brandCharacters,
  brandSceneById,
  brandScenes,
  cancelAssetBuild,
  commit,
  getAssetBuild,
  forgetAssetBuild,
  isCustomPresenter,
  listAssetBuilds,
  lintSceneProse,
  presenterRecordFrom,
  runningAssetBuildCount,
  sceneRecordFrom,
  scenePreviewPrompt,
  startAssetBuild,
  type Analyzer,
  type AssetBuildDeps,
  type CustomScene,
} from './customAssets.js';
import { createCodexAnalyzer, createCodexSetup, type CodexSetup } from '@scenri/engine-codex';
import { registerAccessGuard, type AccessOptions } from './access.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Abort in-flight generations, close the server, close the database. Idempotent. */
    drain(): Promise<void>;
    /** The update checker; serve.ts starts its daily schedule after listen. */
    updates: UpdateChecker;
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
  runtime?: { installKind: InstallKind; supervised: boolean; launcherProtocol?: number };
  /** The staging function, injected in tests so no npm runs. */
  stageImpl?: typeof stageVersion;
  /** process.exit, injected in tests so the restart route can be observed. */
  exitImpl?: (code: number) => void;
  /** Reads a brand's own references into structured records. Injected in tests. */
  analyzer?: Analyzer;
  /** Installs and signs in the local Codex CLI for the setup wizard. Injected in tests. */
  codexSetup?: CodexSetup;
}

/** Settings keys exposed via the API. Secrets are write-only: reads return booleans. */
const SECRET_KEYS = ['openrouter_api_key', 'replicate_api_token', 'fal_key'];

/** Human-readable "A", "A and B", "A, B and C" for error copy. */
function joinNames(labels: string[]): string {
  const uniq = [...new Set(labels)];
  if (uniq.length <= 1) return uniq[0] ?? '';
  return `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`;
}

function brandContext(core: Core, brandId: string): BrandContext {
  const brand = core.store.getBrand(brandId);
  if (!brand) throw new Error('brand not found');
  const assetPaths: Record<string, string> = {};
  const json = brand.json as any;
  for (const logo of json.logos ?? []) {
    const ref = String(logo.file ?? '');
    if (ref.startsWith('asset:') && core.images.has(ref.slice(6))) assetPaths[ref] = core.images.pathFor(ref.slice(6));
  }
  return { brand: brand.json, assetPaths };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `asset:<hash>` → `<hash>`; anything else (a URL, a relative path) → null. */
const assetHash = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  return s.startsWith('asset:') ? s.slice(6) : null;
};

const LOGO_ROLES = ['primary', 'mark', 'wordmark', 'monochrome', 'alternate'] as const;
const LOGO_BACKGROUNDS = ['light', 'dark', 'any'] as const;

/** Normalize an uploaded product shot: whatever arrived, store a PNG. */
const toPng = (buf: Buffer): Promise<Buffer> => sharp(buf).png().toBuffer();

/** One standard image, for asking an engine what it charges. */
const COST_PROBE = {
  prompt: '',
  brand: { brand: {}, assetPaths: {} },
  width: 1024,
  height: 1024,
  count: 1,
} as GenerateRequest;

/**
 * The same for a brand mark, with two differences that only matter for marks.
 *
 * `density` because a vector mark otherwise rasterizes at its intrinsic box —
 * for a favicon that is 16px, which is unusable as a reference image. The size
 * cap because a mark arriving as a 6000px export is a reference the model never
 * reads at that resolution, and every attachment is copied per generation.
 */
const MARK_MAX_EDGE = 2048;
const toMarkPng = (buf: Buffer): Promise<Buffer> =>
  sharp(buf, { density: 384 })
    .resize({ width: MARK_MAX_EDGE, height: MARK_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

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
    const e = err as { statusCode?: number; message?: string };
    const status = err instanceof SpendCapError ? 402 : (e.statusCode ?? 500);
    reply.status(status).send({ error: e.message ?? 'unexpected error' });
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

  /**
   * The half of an upload every asset route shares: read the multipart file,
   * reject the empty and the unreadable, and store the normalized bytes.
   *
   * Returns a result rather than throwing, because each caller has its own
   * 404-first ordering and its own idea of what a bad file means.
   */
  const readImagePart = async (
    req: any,
    normalize: (buf: Buffer) => Promise<Buffer>,
  ): Promise<{ hash: string; fields: any; filename?: string } | { error: string }> => {
    const part = await req.file();
    if (!part) return { error: 'multipart file field required' };
    const buf: Buffer = await part.toBuffer();
    if (buf.length === 0) return { error: 'empty file' };
    try {
      return { hash: core.images.save(await normalize(buf)), fields: part.fields ?? {}, filename: part.filename };
    } catch {
      // sharp throws on anything it cannot decode. Without this the user gets a
      // 500 through setErrorHandler for the entirely ordinary act of dragging a
      // PDF onto a dropzone.
      return { error: 'that file is not an image we can read' };
    }
  };

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
      const part = await readImagePart(req, toPng);
      if ('error' in part) return reply.status(400).send({ error: part.error });
      hashes = [part.hash];
      name = String(part.fields?.name?.value ?? part.filename ?? spec.fallback).slice(0, 80);
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
      createdWith: `${meta.name}/${meta.version}`,
    });
    const { brand: merged, suggestions } = mergeScrape(brand.json, scraped);
    const v = validateBrand(merged);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    const row = core.store.updateBrand(brand.id, merged as any);
    return { ...row, warnings, suggestions };
  });

  // ---- brand marks (logos)
  //
  // Identity is the content hash, never the array index: a logo entry has no id
  // of its own, and an index-addressed delete races any concurrent write to the
  // same row (a catalog import, the product routes) and removes the wrong mark.
  const readLogos = (json: any): any[] => (Array.isArray(json.logos) ? json.logos : []);
  const findLogo = (json: any, hash: string) => readLogos(json).findIndex((l) => assetHash(l?.file) === hash);
  /** A supplied enum value must be one the schema allows: `null` means reject, never quietly default. */
  const enumField = (raw: unknown, allowed: readonly string[], fallback: string | undefined): string | null => {
    const v = raw === undefined || raw === null ? '' : String(raw);
    if (!v) return fallback ?? '';
    return allowed.includes(v) ? v : null;
  };

  app.post('/api/brands/:id/logos', async (req: any, reply: any) => {
    const brand = core.store.getBrand(req.params.id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const json = { ...(brand.json as any) };
    const logos = [...readLogos(json)];
    const part = await readImagePart(req, toMarkPng);
    if ('error' in part) return reply.status(400).send({ error: part.error });
    // The store is content-addressed, so re-uploading the same artwork yields
    // the same hash. Appending would put two entries in the array that no
    // hash-addressed patch or delete could ever tell apart, so the second
    // upload updates the first instead: a mark is identified by its pixels, and
    // the same pixels under two roles is not a thing a brand has.
    const existing = logos.findIndex((l) => assetHash(l?.file) === part.hash);
    const role = enumField(
      part.fields?.role?.value,
      LOGO_ROLES,
      existing !== -1 ? logos[existing].role : logos.length ? 'alternate' : 'primary',
    );
    const background = enumField(part.fields?.background?.value, LOGO_BACKGROUNDS, 'any');
    if (role === null || background === null)
      return reply.status(400).send({ error: 'unknown logo role or background' });
    const entry = { role, file: `asset:${part.hash}`, background };
    if (existing !== -1) logos[existing] = entry;
    else logos.push(entry);
    json.logos = logos;
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
  });

  app.patch('/api/brands/:id/logos/:hash', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const json = { ...(brand.json as any) };
    const idx = findLogo(json, String((req.params as any).hash));
    if (idx === -1) return reply.status(404).send({ error: 'logo not found' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if ('role' in body) {
      const role = enumField(body.role, LOGO_ROLES, undefined);
      if (!role) return reply.status(400).send({ error: 'unknown logo role' });
      patch.role = role;
    }
    if ('background' in body) {
      const bg = enumField(body.background, LOGO_BACKGROUNDS, undefined);
      if (!bg) return reply.status(400).send({ error: 'unknown logo background' });
      patch.background = bg;
    }
    // Cleared prose is an absent key, not an empty string: the schema's enums
    // and formats reject '' outright, which would 400 the whole document and
    // silently stop every other section of the Brand page from saving.
    if ('clearSpace' in body) {
      const cs = String(body.clearSpace ?? '').slice(0, 200);
      if (cs) patch.clearSpace = cs;
    }
    json.logos = readLogos(json).map((l, i) => {
      if (i !== idx) return l;
      const next = { ...l, ...patch };
      if ('clearSpace' in body && !patch.clearSpace) delete next.clearSpace;
      return next;
    });
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
  });

  /**
   * The brand rules the compiler appends to every shot in this brand.
   *
   * The composer shows this verbatim, which is what keeps an always-applied
   * rule from being an invisible one. The studio cannot import compileBrief (it
   * has no workspace dependencies), and a second hand-written copy of the
   * wording in the UI is exactly the drift this endpoint exists to prevent.
   */
  app.get('/api/brands/:id/directives', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return { directives: brandRuleDirectives(brand.json as any) };
  });

  app.delete('/api/brands/:id/logos/:hash', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const json = { ...(brand.json as any) };
    const idx = findLogo(json, String((req.params as any).hash));
    if (idx === -1) return reply.status(404).send({ error: 'logo not found' });
    // The blob itself stays: the store is content-addressed, so the same bytes
    // may still be a product shot or a mark on another brand.
    json.logos = readLogos(json).filter((_, i) => i !== idx);
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
  });
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
  // Manual products only: add one more reference angle to a product that
  // already exists, rather than creating a new one — what the Product page's
  // per-category reference checklist uploads into.
  app.post('/api/brands/:id/products/:productId/shots', async (req: any, reply: any) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const productId = String((req.params as any).productId);
    const json = { ...(brand.json as any) };
    const products: any[] = json.products ?? [];
    const idx = products.findIndex((p) => p.id === productId);
    if (idx === -1) return reply.status(404).send({ error: 'product not found' });
    const part = await readImagePart(req, toPng);
    if ('error' in part) return reply.status(400).send({ error: part.error });
    const hash = part.hash;
    const angle = part.fields?.angle?.value ? String(part.fields.angle.value).slice(0, 60) : undefined;
    const shot: any = { file: `asset:${hash}`, locked: true };
    if (angle) shot.angle = angle;
    json.products = products.map((p, i) => (i === idx ? { ...p, shots: [...(p.shots ?? []), shot] } : p));
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
  });

  // ---- catalog import (store URL → full product library)
  app.get('/api/brands/:id/products-library', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const products = core.catalog.listLibraryProducts(brand.id, brand.json);
    const source = core.catalog.getSourceForBrand(brand.id);
    return { products, source };
  });
  app.get('/api/brands/:id/catalog/source', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return { source: core.catalog.getSourceForBrand(brand.id) };
  });
  app.post('/api/brands/:id/catalog/import', async (req, reply) => {
    const brandId = (req.params as any).id;
    const brand = core.store.getBrand(brandId);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const url = String((req.body as any)?.url ?? (brand.json as any)?.meta?.website ?? '');
    if (!url.trim()) return reply.status(400).send({ error: 'url required' });
    try {
      return startCatalogImport({ core, fetchImpl: opts.fetchImpl }, brandId, url);
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'import failed' });
    }
  });
  app.get('/api/brands/:id/catalog/jobs/:jobId', async (req, reply) => {
    const brandId = (req.params as any).id;
    const job = core.catalog.getJob((req.params as any).jobId);
    if (!job || job.brandId !== brandId) return reply.status(404).send({ error: 'job not found' });
    return job;
  });
  app.get('/api/brands/:id/catalog/jobs', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return { jobs: core.catalog.listJobs(brand.id) };
  });
  app.post('/api/brands/:id/catalog/jobs/:jobId/cancel', async (req, reply) => {
    const brandId = (req.params as any).id;
    const job = core.catalog.getJob((req.params as any).jobId);
    if (!job || job.brandId !== brandId) return reply.status(404).send({ error: 'job not found' });
    cancelCatalogImport(job.id);
    return { ok: true };
  });
  app.delete('/api/brands/:id/catalog/products/:productId', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const pid = String((req.params as any).productId).replace(/^cat-/, '');
    const row = core.catalog.getProduct(pid);
    if (!row || row.brandId !== brand.id) return reply.status(404).send({ error: 'product not found' });
    core.catalog.deleteCatalogProduct(pid);
    return { ok: true };
  });
  // Catalog products only: a category override. Everything else about an
  // imported product (name, price, variants...) comes from the store, so
  // only the field this app itself invents is editable here.
  app.patch('/api/brands/:id/catalog/products/:productId', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const pid = String((req.params as any).productId).replace(/^cat-/, '');
    const row = core.catalog.getProduct(pid);
    if (!row || row.brandId !== brand.id) return reply.status(404).send({ error: 'product not found' });
    const body = (req.body ?? {}) as { category?: string | null };
    const updated = core.catalog.updateProduct(pid, { category: body.category ?? null });
    return { product: updated };
  });

  // ---- scenes (+ their preview imagery when generated)
  const templatesRoot = opts.templatesDir ?? defaultScenesDir();
  const previewPath = (id: string) => join(templatesRoot, 'previews', `${id}.jpg`);
  // chips tint from their template's own preview; extracted once per process
  const previewColors = new Map<string, string | null>();
  const previewColor = async (id: string) => {
    if (previewColors.has(id)) return previewColors.get(id) ?? null;
    const path = previewPath(id);
    const hex = existsSync(path) ? await vibrantColor(path) : null;
    previewColors.set(id, hex);
    return hex;
  };
  const decorate = async (s: Scene) => ({
    ...s,
    previewUrl: existsSync(previewPath(s.id)) ? `/api/scene-thumbnails/${s.id}.jpg${mtimeQS(previewPath(s.id))}` : null,
    previewColor: await previewColor(s.id),
  });
  app.get('/api/scenes', async () => ({
    scenes: await Promise.all(scenes.map(decorate)),
    ...facetsOf(scenes),
  }));
  /** @deprecated kept one release so stored briefs and outside callers keep resolving. */
  app.get('/api/templates', async () => Promise.all(scenes.map(decorate)));
  // A generated look's own jpg can be regenerated at the same filename (a
  // rejected preview, redone). `max-age=0, must-revalidate` (an earlier fix)
  // still left every already-open tab showing pre-regeneration bytes
  // indefinitely — a browser that cached the URL under an old, longer-lived
  // policy has no reason to ever re-ask, hard reload included in at least
  // one observed browser/OS combination, and there is no way to reach into
  // a user's disk cache from the server to evict the old entry. The actual
  // fix is to stop reusing the same URL for different content: `mtimeQS`
  // appends the file's own mtime as a query string everywhere a preview/
  // reference-frame URL is built, so a regenerated file is a genuinely new
  // URL the browser has never cached anything under. That makes it safe to
  // cache aggressively again — correctness now comes from the URL changing,
  // not from asking the server to re-check.
  const mtimeQS = (path: string) => (existsSync(path) ? `?v=${Math.round(statSync(path).mtimeMs)}` : '');
  const serveJpeg = (req: FastifyRequest, reply: FastifyReply, path: string) => {
    const etag = `"${statSync(path).mtimeMs}"`;
    reply.header('cache-control', 'public, max-age=31536000, immutable').header('etag', etag);
    if (req.headers['if-none-match'] === etag) return reply.status(304).send();
    return reply.header('content-type', 'image/jpeg').send(readFileSync(path));
  };
  app.get('/api/scene-thumbnails/:file', async (req, reply) => {
    const m = /^([a-z0-9-]+)\.jpg$/.exec(String((req.params as any).file));
    if (!m || !existsSync(previewPath(m[1]))) return reply.status(404).send({ error: 'no preview' });
    return serveJpeg(req, reply, previewPath(m[1]));
  });
  // A scene's reference set: several frames sharing one light, one per subject.
  // Both segments are pattern-guarded, so nothing outside previews/ is reachable.
  const refPath = (id: string, slot: string) => join(templatesRoot, 'previews', id, `${slot}.jpg`);
  /** Which reference frames a scene actually has. One ask, instead of probing. */
  app.get('/api/scene-previews/:id', async (req, reply) => {
    const id = /^[a-z0-9-]+$/.exec(String((req.params as any).id))?.[0];
    if (!id) return reply.status(400).send({ error: 'bad scene id' });
    const dir = join(templatesRoot, 'previews', id);
    if (!existsSync(dir)) return { frames: [] };
    const frames = readdirSync(dir)
      .filter((f) => /^ref-[0-9]{2}\.jpg$/.test(f))
      .sort()
      .map((f) => `/api/scene-previews/${id}/${f}${mtimeQS(join(dir, f))}`);
    return { frames };
  });
  app.get('/api/scene-previews/:id/:file', async (req, reply) => {
    const p = req.params as any;
    const id = /^[a-z0-9-]+$/.exec(String(p.id))?.[0];
    const slot = /^(ref-[0-9]{2})\.jpg$/.exec(String(p.file))?.[1];
    if (!id || !slot || !existsSync(refPath(id, slot))) return reply.status(404).send({ error: 'no frame' });
    return serveJpeg(req, reply, refPath(id, slot));
  });

  // ---- presenters (curated identity catalog). A presenter attaches straight
  // into a brief like a Scene does — see brandJsonWithResolvedPresenters below.
  const presentersDir = join(templatesRoot, 'presenters');
  const { presenters } = loadPresenters(presentersDir);
  const presenterThumbPath = (id: string) => join(templatesRoot, 'previews', 'presenters', `${id}.jpg`);
  const avatarPath = (id: string) => presenterAvatarPath(templatesRoot, id);
  const decoratePresenter = (p: Presenter) => ({
    ...p,
    previewUrl: existsSync(presenterThumbPath(p.id))
      ? `/api/presenter-thumbnails/${p.id}.jpg${mtimeQS(presenterThumbPath(p.id))}`
      : null,
    // Square portrait for small/square surfaces. Null when absent so every
    // consumer can fall back to previewUrl and nothing breaks without one.
    avatarUrl: existsSync(avatarPath(p.id)) ? `/api/presenter-avatars/${p.id}.jpg${mtimeQS(avatarPath(p.id))}` : null,
  });
  app.get('/api/presenters', async () => ({
    presenters: presenters.map(decoratePresenter),
    ...presenterFacetsOf(presenters),
  }));
  app.get('/api/presenter-thumbnails/:file', async (req, reply) => {
    const m = /^([a-z0-9-]+)\.jpg$/.exec(String((req.params as any).file));
    if (!m || !existsSync(presenterThumbPath(m[1]))) return reply.status(404).send({ error: 'no preview' });
    return serveJpeg(req, reply, presenterThumbPath(m[1]));
  });
  app.get('/api/presenter-avatars/:file', async (req, reply) => {
    const m = /^([a-z0-9-]+)\.jpg$/.exec(String((req.params as any).file));
    if (!m || !existsSync(avatarPath(m[1]))) return reply.status(404).send({ error: 'no avatar' });
    return serveJpeg(req, reply, avatarPath(m[1]));
  });
  // A presenter's reference set: the same 4-angle identity plan every time.
  // Both segments are pattern-guarded, so nothing outside previews/ is reachable.
  app.get('/api/presenter-previews/:id', async (req, reply) => {
    const id = /^[a-z0-9-]+$/.exec(String((req.params as any).id))?.[0];
    if (!id) return reply.status(400).send({ error: 'bad presenter id' });
    const dir = join(templatesRoot, 'previews', 'presenters', id);
    if (!existsSync(dir)) return { frames: [] };
    const frames = readdirSync(dir)
      .filter((f) => /^ref-[0-9]{2}\.jpg$/.test(f))
      .sort()
      .map((f) => `/api/presenter-previews/${id}/${f}${mtimeQS(join(dir, f))}`);
    return { frames };
  });
  app.get('/api/presenter-previews/:id/:file', async (req, reply) => {
    const p = req.params as any;
    const id = /^[a-z0-9-]+$/.exec(String(p.id))?.[0];
    const slot = /^(ref-[0-9]{2})\.jpg$/.exec(String(p.file))?.[1];
    const path = id && slot ? presenterRefPath(templatesRoot, id, slot) : null;
    if (!path || !existsSync(path)) return reply.status(404).send({ error: 'no frame' });
    return serveJpeg(req, reply, path);
  });

  // ---- custom presenters and scenes (the ones a brand builds for itself)
  //
  // These live in the brand document, not in templates/, and everything past
  // this point treats them identically to the curated ones: compileBrief
  // already prefers `characters[]` over the presenter catalog, and the scene
  // resolver below prefers `scenes[]` over the scene catalog.
  const analyzer: Analyzer | null = opts.analyzer ?? createCodexAnalyzer();

  /**
   * Which engine draws a person's studio views and a scene's preview.
   *
   * Prefers codex-cli: it is local, adds no bill of ours on top of the plan the
   * user already pays for, and carries six references, which is what a chained
   * identity plan needs. Any
   * available engine that can take a reference at all will do; one that takes
   * none could not hold a face, so it is not offered.
   */
  const buildEngine = async (): Promise<EngineAdapter | null> => {
    const ordered = [...engines.all()].sort((a, b) => {
      const rank = (e: EngineAdapter) => (e.capabilities().id === 'codex-cli' ? 0 : 1);
      return rank(a) - rank(b);
    });
    for (const engine of ordered) {
      const caps = engine.capabilities();
      if (!caps.maxReferenceImages || caps.placeholder) continue;
      if ((await engine.isAvailable()).ok) return engine;
    }
    return null;
  };

  const buildDeps = async (): Promise<AssetBuildDeps> => ({
    core,
    engine: await buildEngine(),
    analyzer: (await analyzer?.isAvailable())?.ok ? analyzer : null,
    brandContext: (brandId: string) => brandContext(core, brandId),
    // The filters that already exist, so a new asset lands under a tab a
    // person can actually click rather than inventing a category of one.
    vocabulary: { ...facetsOf(scenes), categories: presenterFacetsOf(presenters).categories },
  });

  /** What a creation flow needs to know before it promises anything. */
  app.get('/api/asset-builds/capabilities', async () => {
    const [engine, probe] = await Promise.all([buildEngine(), analyzer?.isAvailable() ?? { ok: false }]);
    return {
      canAnalyze: probe.ok,
      analyzeReason: probe.ok ? null : (probe.reason ?? null),
      canGenerate: !!engine,
      engineId: engine?.capabilities().id ?? null,
      engineName: engine?.capabilities().displayName ?? null,
      /**
       * True when scenri cannot price this per image, because it is not billed
       * through a key we hold. NOT the same as costing the user nothing: the
       * local Codex engine spends the Codex allowance on their ChatGPT plan,
       * which only OpenAI can meter. Copy built on this flag must say "nothing
       * billed through scenri", never "free".
       */
      free: engine ? (await engine.costEstimate(COST_PROBE).catch(() => 0)) <= 0 : true,
    };
  });

  const brandOr404 = (req: any, reply: any) => {
    const brand = core.store.getBrand(String(req.params.id));
    if (!brand) {
      reply.status(404).send({ error: 'brand not found' });
      return null;
    }
    return brand;
  };

  app.post('/api/brands/:id/asset-builds', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const body = (req.body ?? {}) as any;
    const kind = String(body.kind ?? '');
    if (kind !== 'presenter' && kind !== 'scene')
      return reply.status(400).send({ error: 'kind must be presenter|scene' });
    try {
      return startAssetBuild(await buildDeps(), {
        brandId: brand.id,
        kind,
        name: String(body.name ?? ''),
        instruction: body.instruction == null ? undefined : String(body.instruction),
        imageHashes: Array.isArray(body.imageHashes) ? body.imageHashes.map((h: unknown) => String(h)) : [],
        facets: Array.isArray(body.facets) ? body.facets.map((f: unknown) => String(f)) : [],
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'could not start' });
    }
  });
  app.get('/api/brands/:id/asset-builds', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    return { builds: listAssetBuilds(brand.id) };
  });
  app.get('/api/brands/:id/asset-builds/:jobId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const job = getAssetBuild(String((req.params as any).jobId));
    if (!job || job.brandId !== brand.id) return reply.status(404).send({ error: 'build not found' });
    return job;
  });
  /**
   * Forget a build that finished badly. `prune` only drops finished builds past
   * the newest twelve, so without this a failed card sits on the wall for twelve
   * more builds with no way to dismiss it.
   */
  app.delete('/api/brands/:id/asset-builds/:jobId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const job = getAssetBuild(String((req.params as any).jobId));
    if (!job || job.brandId !== brand.id) return reply.status(404).send({ error: 'build not found' });
    forgetAssetBuild(job.id);
    return { ok: true };
  });
  app.post('/api/brands/:id/asset-builds/:jobId/cancel', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const job = getAssetBuild(String((req.params as any).jobId));
    if (!job || job.brandId !== brand.id) return reply.status(404).send({ error: 'build not found' });
    cancelAssetBuild(job.id);
    return { ok: true };
  });

  /**
   * Write a presenter directly, without a build.
   *
   * This is the path when nothing can read the photos: they become the
   * references as they are, and every field stays editable on the presenter's
   * own page. Named `presenters` rather than `characters` because there is
   * still no manual-add route for the legacy roster shape.
   */
  app.post('/api/brands/:id/presenters', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const built = presenterRecordFrom((req.body ?? {}) as any);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.characters = [...brandCharacters(json), built.presenter];
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return { presenter: built.presenter, brand: core.store.getBrand(brand.id) };
  });
  app.patch('/api/brands/:id/presenters/:presenterId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).presenterId);
    const base = brandCharacters(brand.json).find((c: any) => c.id === id);
    if (!base) return reply.status(404).send({ error: 'presenter not found' });
    if (!isCustomPresenter(base)) return reply.status(400).send({ error: 'this presenter is not editable' });
    const built = presenterRecordFrom((req.body ?? {}) as any, base);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.characters = brandCharacters(json).map((c: any) => (c.id === id ? built.presenter : c));
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return { presenter: built.presenter, brand: core.store.getBrand(brand.id) };
  });
  app.delete('/api/brands/:id/presenters/:presenterId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).presenterId);
    const base = brandCharacters(brand.json).find((c: any) => c.id === id);
    if (!base) return reply.status(404).send({ error: 'presenter not found' });
    if (!isCustomPresenter(base)) return reply.status(400).send({ error: 'this presenter is not editable' });
    // Shots already made keep their prompt and their pixels. A brief that names
    // this person again will say so; see compileBrief's roster warning.
    commit(core, brand.id, (json) => {
      json.characters = brandCharacters(json).filter((c: any) => c.id !== id);
    });
    return { ok: true };
  });

  app.post('/api/brands/:id/scenes', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const built = sceneRecordFrom((req.body ?? {}) as any);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.scenes = [...brandScenes(json), built.scene];
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return {
      scene: built.scene,
      warnings: lintSceneProse(brand.json, built.scene),
      brand: core.store.getBrand(brand.id),
    };
  });
  app.patch('/api/brands/:id/scenes/:sceneId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).sceneId);
    const base = brandScenes(brand.json).find((s) => s.id === id);
    if (!base) return reply.status(404).send({ error: 'scene not found' });
    const built = sceneRecordFrom((req.body ?? {}) as any, base);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.scenes = brandScenes(json).map((s) => (s.id === id ? built.scene : s));
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return {
      scene: built.scene,
      warnings: lintSceneProse(brand.json, built.scene),
      brand: core.store.getBrand(brand.id),
    };
  });
  app.delete('/api/brands/:id/scenes/:sceneId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).sceneId);
    if (!brandScenes(brand.json).some((s) => s.id === id)) return reply.status(404).send({ error: 'scene not found' });
    commit(core, brand.id, (json) => {
      json.scenes = brandScenes(json).filter((s) => s.id !== id);
    });
    return { ok: true };
  });

  /** Redraw a scene's example. One generation, asked for explicitly. */
  app.post('/api/brands/:id/scenes/:sceneId/preview', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).sceneId);
    const scene = brandScenes(brand.json).find((s) => s.id === id);
    if (!scene) return reply.status(404).send({ error: 'scene not found' });
    const engine = await buildEngine();
    if (!engine) return reply.status(400).send({ error: 'no engine here can draw a preview' });
    const request = {
      prompt: scenePreviewPrompt(scene as CustomScene),
      brand: brandContext(core, brand.id),
      width: scene.width,
      height: scene.height,
      count: 1,
    };
    const engineId = engine.capabilities().id;
    core.ledger.assertUnderCap(engineId, await engine.costEstimate(request).catch(() => 0));
    const result = await engine.generate(request);
    core.ledger.recordCost(engineId, null, result.costUsd);
    const hash = result.images[0];
    if (!hash) return reply.status(500).send({ error: 'the engine returned no image' });
    commit(core, brand.id, (json) => {
      json.scenes = brandScenes(json).map((s) => (s.id === id ? { ...s, preview: `asset:${hash}` } : s));
    });
    return { preview: `asset:${hash}`, brand: core.store.getBrand(brand.id) };
  });

  // ---- demo products (curated, fictional-but-premium product catalog). A
  // demo product attaches straight into a brief like a Presenter does — see
  // brandJsonWithResolvedDemoProducts below. Never touches a real brand's
  // own products[].
  const { demoProducts } = loadDemoProducts(join(templatesRoot, 'demo-products'));
  const demoProductById = demoProductResolver(demoProducts);
  // Thumbnail is always the category's "primary" angle (three-quarter where
  // the category has one, else front) — a slightly dimensional hero shot,
  // never a creative-campaign image. See primaryAngleFor/demoProductRefPath.
  const demoProductThumbPath = (id: string) => {
    const p = demoProductById(id);
    if (!p) return null;
    const preferred = demoProductRefPath(templatesRoot, id, primaryAngleFor(p.category));
    if (existsSync(preferred)) return preferred;
    // A product may ship a partial angle set — hand-supplied reference photos
    // rarely cover all six. Fall back to the first angle actually on disk so
    // the catalog card renders instead of 404-ing on a missing primary angle.
    const angles = PRODUCT_ANGLES_BY_CATEGORY[p.category] ?? PRODUCT_ANGLES_BY_CATEGORY.other;
    for (const angle of angles) {
      const candidate = demoProductRefPath(templatesRoot, id, angle);
      if (existsSync(candidate)) return candidate;
    }
    return preferred;
  };
  const decorateDemoProduct = (p: DemoProduct) => {
    const path = demoProductThumbPath(p.id);
    return {
      ...p,
      previewUrl: path && existsSync(path) ? `/api/demo-product-thumbnails/${p.id}.jpg${mtimeQS(path)}` : null,
    };
  };
  app.get('/api/demo-products', async () => ({
    demoProducts: demoProducts.map(decorateDemoProduct),
    ...demoProductFacetsOf(demoProducts),
  }));
  app.get('/api/demo-product-thumbnails/:file', async (req, reply) => {
    const m = /^([a-z0-9-]+)\.jpg$/.exec(String((req.params as any).file));
    const path = m ? demoProductThumbPath(m[1]) : null;
    if (!path || !existsSync(path)) return reply.status(404).send({ error: 'no preview' });
    return serveJpeg(req, reply, path);
  });

  // A demo product's full reference set. The thumbnail route above exposes one
  // angle; this exposes all of them, which is what a detail page needs. Angles
  // are returned with their key so the client can label each frame — a product's
  // angles are semantic ("sole-detail", "worn-scale"), unlike a presenter's
  // positional ref-0N slots. Both segments are pattern-guarded.
  app.get('/api/demo-product-previews/:id', async (req, reply) => {
    const id = /^[a-z0-9-]+$/.exec(String((req.params as any).id))?.[0];
    if (!id) return reply.status(400).send({ error: 'bad product id' });
    const product = demoProductById(id);
    if (!product) return { frames: [] };
    const angles = PRODUCT_ANGLES_BY_CATEGORY[product.category] ?? PRODUCT_ANGLES_BY_CATEGORY.other;
    const frames = angles
      .map((angle) => ({ angle, path: demoProductRefPath(templatesRoot, id, angle) }))
      .filter((f) => existsSync(f.path))
      .map((f) => ({ angle: f.angle, url: `/api/demo-product-previews/${id}/${f.angle}.jpg${mtimeQS(f.path)}` }));
    return { frames };
  });
  app.get('/api/demo-product-previews/:id/:file', async (req, reply) => {
    const p = req.params as any;
    const id = /^[a-z0-9-]+$/.exec(String(p.id))?.[0];
    const angle = /^([a-z0-9-]+)\.jpg$/.exec(String(p.file))?.[1];
    const path = id && angle ? demoProductRefPath(templatesRoot, id, angle) : null;
    if (!path || !existsSync(path)) return reply.status(404).send({ error: 'no frame' });
    return serveJpeg(req, reply, path);
  });

  // ---- showcase (curated homepage gallery). Each entry is a real recipe —
  // the exact brief.tokens that produced its hero image — so opening one
  // reproduces the identical chips, ready to remix.
  const { showcase } = loadShowcase(join(templatesRoot, 'showcase'));
  const showcaseHeroPath = (id: string) => join(templatesRoot, 'previews', 'showcase', `${id}.jpg`);
  const decorateShowcase = (s: ShowcaseEntry) => ({
    ...s,
    previewUrl: existsSync(showcaseHeroPath(s.id))
      ? `/api/showcase-previews/${s.id}.jpg${mtimeQS(showcaseHeroPath(s.id))}`
      : null,
  });
  app.get('/api/showcase', async () => ({
    showcase: showcase.map(decorateShowcase),
    ...showcaseFacetsOf(showcase),
  }));
  app.get('/api/showcase-previews/:file', async (req, reply) => {
    const m = /^([a-z0-9-]+)\.jpg$/.exec(String((req.params as any).file));
    if (!m || !existsSync(showcaseHeroPath(m[1]))) return reply.status(404).send({ error: 'no preview' });
    return serveJpeg(req, reply, showcaseHeroPath(m[1]));
  });

  // ---- brief compiler: the composer previews exactly what will run
  app.get('/api/formats', async () => FORMATS);
  app.post('/api/brief/preview', async (req, reply) => {
    const { brief, engineId, brandId } = req.body as any;
    const brand = core.store.getBrand(String(brandId));
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const engine = engines.get(String(engineId));
    if (!engine) return reply.status(400).send({ error: 'unknown engine' });
    if (!brief || !Array.isArray(brief.tokens))
      return reply.status(400).send({ error: 'brief.tokens must be an array' });
    const briefErrors = validateBrief(brief);
    if (briefErrors.length) return reply.status(400).send({ error: `invalid brief: ${briefErrors.join('; ')}` });
    const brandJson = await brandJsonWithResolvedPresenters(
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
    );
    const sceneById = sceneFor(brandJson);
    const compiled = compileBrief(brief as Brief, {
      brand: brandJson,
      images: core.images,
      engineCaps: engine.capabilities(),
      template: brief.templateId ? sceneById(String(brief.templateId)) : undefined,
      templateById: sceneById,
    });
    // paths are server-side detail; the UI works in hashes
    const { referenceImages, ...rest } = compiled;
    return { ...rest, referenceCount: referenceImages.length };
  });

  // ---- projects + tree
  app.post('/api/projects', async (req, reply) => {
    const { brandId, name } = req.body as any;
    if (!core.store.getBrand(String(brandId))) return reply.status(404).send({ error: 'brand not found' });
    return core.store.createProject(String(brandId), String(name || 'Untitled'));
  });
  app.get('/api/projects', async (req) => core.store.listProjects(String((req.query as any).brandId ?? '')));
  app.get('/api/projects/:id/tree', async (req, reply) => {
    const p = core.store.getProject((req.params as any).id);
    if (!p) return reply.status(404).send({ error: 'project not found' });
    return { project: p, nodes: core.store.treeFor(p.id) };
  });
  /**
   * Everything the brand has running or lately finished, generations and
   * catalog imports together. One request, so the notifications bell costs the
   * same whether you have two projects or forty.
   */
  app.get('/api/brands/:id/activity', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const limit = Math.min(Number((req.query as any).limit) || 60, 200);
    return { nodes: core.store.recentActivity(brand.id, limit), jobs: core.catalog.listJobs(brand.id) };
  });

  // ---- workspace + sets
  /**
   * The whole brand in one answer: its shots, its sets, and who is in what.
   *
   * The feed used to be assembled by asking for every project's tree in turn,
   * so a brand with forty of them cost forty requests to draw one screen. There
   * is one project now and the sets are a filter over it, so there is one ask.
   */
  app.get('/api/brands/:id/workspace', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const project = core.store.workspaceFor(brand.id);
    return {
      project,
      nodes: core.store.treeFor(project.id),
      sets: core.store.listSets(brand.id),
      membership: core.store.membershipFor(brand.id),
    };
  });
  app.get('/api/brands/:id/sets', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return core.store.listSets(brand.id);
  });
  app.post('/api/brands/:id/sets', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    return core.store.createSet(brand.id, name);
  });
  app.patch('/api/sets/:id', async (req, reply) => {
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    const set = core.store.renameSet((req.params as any).id, name);
    if (!set) return reply.status(404).send({ error: 'set not found' });
    return set;
  });
  /** The set goes; every shot that was in it stays exactly where it was. */
  app.delete('/api/sets/:id', async (req, reply) => {
    if (!core.store.getSet((req.params as any).id)) return reply.status(404).send({ error: 'set not found' });
    core.store.deleteSet((req.params as any).id);
    return { ok: true };
  });
  app.post('/api/sets/:id/nodes', async (req, reply) => {
    const set = core.store.getSet((req.params as any).id);
    if (!set) return reply.status(404).send({ error: 'set not found' });
    const raw = (req.body as any)?.nodeIds;
    const nodeIds = (Array.isArray(raw) ? raw : []).map(String).filter((id) => core.store.getNode(id));
    if (nodeIds.length === 0) return reply.status(400).send({ error: 'nodeIds must name at least one shot' });
    core.store.addToSet(set.id, nodeIds);
    return { ok: true, added: nodeIds.length };
  });
  app.delete('/api/sets/:id/nodes/:nodeId', async (req, reply) => {
    const { id, nodeId } = req.params as any;
    if (!core.store.getSet(id)) return reply.status(404).send({ error: 'set not found' });
    core.store.removeFromSet(id, nodeId);
    return { ok: true };
  });

  // ---- codex setup (the guided path for people who have never opened a terminal)
  //
  // These run two official commands on the user's own machine: a global npm
  // install, and `codex login`, which opens their browser. No credential is
  // read, copied or stored here — the session lands in codex's own config and
  // stays there. Both are gated by the same access guard as everything else.
  const codexSetup: CodexSetup = opts.codexSetup ?? createCodexSetup();
  /** One install/login at a time: two concurrent npm installs fight over the same prefix. */
  let codexSetupBusy: 'install' | 'login' | null = null;

  app.get('/api/engines/codex/status', async () => codexSetup.status());

  app.post('/api/engines/codex/install', async (_req, reply) => {
    if (codexSetupBusy) return reply.status(409).send({ error: `already running: ${codexSetupBusy}` });
    codexSetupBusy = 'install';
    try {
      const res = await codexSetup.install();
      const { state } = await codexSetup.status();
      return { ...res, state };
    } finally {
      codexSetupBusy = null;
    }
  });

  app.post('/api/engines/codex/login', async (_req, reply) => {
    if (codexSetupBusy) return reply.status(409).send({ error: `already running: ${codexSetupBusy}` });
    codexSetupBusy = 'login';
    try {
      const res = await codexSetup.login();
      const { state } = await codexSetup.status();
      return { ...res, state };
    } finally {
      codexSetupBusy = null;
    }
  });

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
      out.push(buf.subarray(0, 8).equals(PNG_SIG) ? h : core.images.save(await sharp(buf).png().toBuffer()));
    }
    return out;
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
          `engine returned ${meta.width}x${meta.height} for a ${expect.width}x${expect.height} request — ` +
            'this engine cannot produce the requested aspect ratio',
        );
    }
  }

  async function runNode(
    nodeId: string,
    engine: EngineAdapter,
    estimate: number,
    work: (signal: AbortSignal) => Promise<{ images: string[]; costUsd: number }>,
    expect?: { width: number; height: number },
  ) {
    const engineId = engine.capabilities().id;
    reserved.set(engineId, (reserved.get(engineId) ?? 0) + estimate);
    const ctrl = new AbortController();
    runningGenerations.set(nodeId, ctrl);
    try {
      const result = await work(ctrl.signal);
      result.images = await normalizePngs(result.images);
      if (expect) await assertAspect(result.images, expect);
      core.store.completeNode(nodeId, result);
      core.ledger.recordCost(engineId, nodeId, result.costUsd);
    } catch (err: any) {
      // the signal is the source of truth for "was this a cancel", not the
      // error shape, which differs across engines (fetch's AbortError, a
      // killed child process, a stopped poll loop)
      if (ctrl.signal.aborted) core.store.cancelNode(nodeId);
      else core.store.failNode(nodeId, String(err?.message ?? err));
    } finally {
      runningGenerations.delete(nodeId);
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
    const engine = engines.get(String(engineId));
    if (!engine) return reply.status(400).send({ error: `unknown engine ${engineId}` });
    const avail = await engine.isAvailable();
    if (!avail.ok) return reply.status(400).send({ error: avail.reason ?? 'engine unavailable' });
    if (kind !== 'generation' && kind !== 'edit')
      return reply.status(400).send({ error: 'kind must be generation|edit' });

    // A null parent would create a node the tree UI can never reach — anchor
    // parentless requests to the project root instead.
    const rootNode = core.store.treeFor(project.id).find((n) => n.kind === 'root');
    if (!rootNode) return reply.status(500).send({ error: 'project has no root node' });
    const resolvedParentId = parentId ? String(parentId) : rootNode.id;

    const ctx = brandContext(core, project.brandId);

    // Structured brief path: one compiler decides prompt, attachments and size.
    let compiled: ReturnType<typeof compileBrief> | null = null;
    if (brief && Array.isArray(brief.tokens)) {
      const briefErrors = validateBrief(brief);
      if (briefErrors.length) return reply.status(400).send({ error: `invalid brief: ${briefErrors.join('; ')}` });
      const brandJson = await brandJsonWithResolvedPresenters(
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
      );
      const sceneById = sceneFor(brandJson);
      compiled = compileBrief(brief as Brief, {
        brand: brandJson,
        images: core.images,
        engineCaps: engine.capabilities(),
        template: brief.templateId ? sceneById(String(brief.templateId)) : undefined,
        templateById: sceneById,
      });
      if (!compiled.prompt.trim()) return reply.status(400).send({ error: 'the brief is empty' });
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
        engineCaps: engine.capabilities(),
        templateById: sceneFor(brandJson),
      });
      if (productId && !compiled.attachments.some((a) => a.role === 'product'))
        return reply.status(400).send({ error: 'product has no usable shots' });
      if (!compiled.prompt.trim()) return reply.status(400).send({ error: 'the brief is empty' });
    }

    let estimate: number;
    let work: (signal: AbortSignal) => Promise<{ images: string[]; costUsd: number }>;
    // Only generations declare a target shape. An edit inherits the source
    // image's dimensions, so there is nothing to check it against.
    let expectShape: { width: number; height: number } | undefined;
    /** For an edit, which image of the parent run it was made from. */
    let editedFrom: string | null = null;

    if (compiled) {
      finalPrompt = compiled.prompt;
      referenceImages = compiled.referenceImages;
      referenceRoles = compiled.attachments.map((a) => a.role);
      width = compiled.width;
      height = compiled.height;
    }

    if (kind === 'generation') {
      const cap = engine.capabilities().maxReferenceImages;
      // An identity reference that cannot be transmitted is not a degraded
      // generation, it is a wrong one: the model invents a product or a face
      // and returns it with full confidence. Refuse instead. Style references
      // are different — losing one costs fidelity of mood, not of subject —
      // so only product/character losses are fatal here.
      const lostIdentity = engine.capabilities().placeholder
        ? []
        : (compiled?.dropped ?? []).filter((d) => d.essential);
      if (lostIdentity.length) {
        const names = joinNames(lostIdentity.map((d) => d.label));
        const kindWord = lostIdentity[0].role === 'product' ? 'product' : 'presenter';
        return reply.code(400).send({
          error: `${engine.capabilities().displayName} cannot carry enough reference images, so ${names} would be named in the prompt but never shown — the result would not be your ${kindWord}. Choose an engine that supports reference images, or remove ${names} from the brief.`,
        });
      }
      const genReq: GenerateRequest = {
        prompt: finalPrompt,
        brand: ctx,
        width: Number(width),
        height: Number(height),
        count: Math.min(Math.max(1, Number(count)), 8),
        ...(referenceImages && cap > 0 ? { referenceImages: referenceImages.slice(0, cap) } : {}),
        ...(referenceRoles && cap > 0 ? { referenceRoles: referenceRoles.slice(0, cap) } : {}),
      };
      estimate = await engine.costEstimate(genReq);
      work = (signal) => engine.generate(genReq, signal);
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
      const cap = engine.capabilities().maxReferenceImages;
      const editReq: EditRequest = {
        instruction: finalPrompt,
        sourceImage: core.images.pathFor(String(srcHash)),
        brand: ctx,
        ...(referenceImages && cap > 0 ? { referenceImages: referenceImages.slice(0, cap) } : {}),
        ...(referenceRoles && cap > 0 ? { referenceRoles: referenceRoles.slice(0, cap) } : {}),
      };
      estimate = await engine.costEstimate(editReq);
      work = (signal) => engine.edit(editReq, signal);
    }

    // throws 402 via handler; include estimates of everything still in flight
    core.ledger.assertUnderCap(engine.capabilities().id, estimate + (reserved.get(engine.capabilities().id) ?? 0));
    const node = core.store.addNode({
      projectId: project.id,
      parentId: resolvedParentId,
      kind,
      prompt: finalPrompt,
      engineId: String(engineId),
    });
    // the resolved source rides along in the brief, which is already a JSON
    // blob on the node, so the record needs no new column to be accurate
    if (brief) core.store.setBrief(node.id, editedFrom ? { ...(brief as object), sourceImage: editedFrom } : brief);
    // Fire and forget: the 202 is the answer and the node's own status carries
    // the outcome. runNode records failures itself, so a rejection here means
    // even that failed — log it, but never let it reach the process unhandled.
    void runNode(node.id, engine, estimate, work, expectShape).catch((err) =>
      app.log.error({ err }, 'node run failed'),
    );
    // Surface the compiler's warnings on the accepted node. These name real
    // fidelity risks — a scene built around a product with none attached, an
    // asset that vanished, a reference the engine could not carry — and were
    // previously computed and then dropped, visible only in the preview call.
    // A caller that skipped preview had no way to learn its brief was degraded.
    return reply.status(202).send(compiled?.warnings?.length ? { ...node, warnings: compiled.warnings } : node);
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
    return core.store.getNode(n.id);
  });
  app.post('/api/nodes/:id/archive', async (req, reply) => {
    const n = core.store.getNode((req.params as any).id);
    if (!n) return reply.status(404).send({ error: 'node not found' });
    core.store.setArchived(n.id, Boolean((req.body as any)?.archived ?? true));
    return core.store.getNode(n.id);
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

  // ---- images / diff / export
  app.get('/api/images/:hash', async (req, reply) => {
    const hash = String((req.params as any).hash);
    if (!core.images.has(hash)) return reply.status(404).send({ error: 'image not found' });
    reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(core.images.read(hash));
  });

  // upload an arbitrary image (moodboard, reference) into the content store
  app.post('/api/images', async (req, reply) => {
    const part = await (req as any).file();
    if (!part) return reply.status(400).send({ error: 'multipart file field required' });
    const buf: Buffer = await part.toBuffer();
    if (buf.length === 0) return reply.status(400).send({ error: 'empty file' });
    const png = await sharp(buf).png().toBuffer(); // normalize any input format
    return { hash: core.images.save(png) };
  });

  app.post('/api/diff', async (req, reply) => {
    const { imageA, imageB } = req.body as any;
    if (!core.images.has(String(imageA)) || !core.images.has(String(imageB)))
      return reply.status(404).send({ error: 'image not found' });
    const d = await driftDiff(core.images.read(String(imageA)), core.images.read(String(imageB)));
    const heatmapHash = core.images.save(d.heatmap);
    return { score: d.score, heatmapHash, width: d.width, height: d.height };
  });

  app.get('/api/export/presets', async () => EXPORT_PRESETS);
  /**
   * The brand as a portable `.brand` bundle.
   *
   * GET, not POST: the client is then a plain anchor with a download
   * attribute, with no blob juggling and no second copy of the filename rule.
   */
  app.get('/api/brands/:id/export', async (req, reply) => {
    const brandId = String((req.params as any).id);
    if (!core.store.getBrand(brandId)) return reply.status(404).send({ error: 'brand not found' });
    const { zip, filename } = await buildBrandBundle(core, brandId);
    reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="${filename}"`);
    return reply.send(zip);
  });

  app.post('/api/export', async (req, reply) => {
    const { imageHash, presets, baseName = 'scenri-export' } = req.body as any;
    if (!core.images.has(String(imageHash))) return reply.status(404).send({ error: 'image not found' });
    const zip = await buildExportZip(
      core.images.read(String(imageHash)),
      String(baseName)
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .slice(0, 60) || 'export',
      Array.isArray(presets) ? presets.map(String) : [],
    );
    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${basename(String(baseName)) || 'export'}.zip"`);
    return reply.send(zip);
  });

  // ---- this machine: where the work lives, and how to get it all out
  // ---- version + lifecycle
  const runtime = opts.runtime ?? { installKind: 'unknown' as const, supervised: false };
  app.get('/api/version', async () => ({
    name: meta.name,
    version: meta.version,
    schema: SCHEMA_VERSION,
    installKind: runtime.installKind,
    supervised: runtime.supervised,
    home: core.home,
  }));

  // ---- updates: check (npm dist-tags, daily, cached) + notes (GitHub release)
  const updates = createUpdateChecker({ name: meta.name, store: core.store, fetchImpl: opts.fetchImpl });
  app.decorate('updates', updates);
  const ghSlug = repoSlug(meta.repository);
  /** The version a build carries before release-please has ever bumped it. */
  const UNRELEASED = '0.0.0';

  // The apply state machine: idle → staging → ready | error. 'ready' also
  // covers a version staged by `scenri update` in a terminal before this boot.
  let applyState: { phase: 'idle' | 'staging' | 'ready' | 'error'; version: string | null; error: string | null } = {
    phase: 'idle',
    version: null,
    error: null,
  };
  const effectiveApply = () => {
    if (applyState.phase === 'idle') {
      const staged = newestStaged(core.home, meta.name);
      if (staged && compareSemver(staged, meta.version) > 0) {
        return { phase: 'ready' as const, version: staged, error: null };
      }
    }
    return applyState;
  };

  /** Why one-click cannot run here, or null when it can. The manual `scenri update` always remains. */
  const REQUIRED_PROTOCOL = 1;
  let npmProbe: boolean | null = null;
  const blockReason = (): 'dev' | 'unsupervised' | 'launcher-too-old' | 'no-npm' | null => {
    if (runtime.installKind === 'dev') return 'dev';
    if (!runtime.supervised) return 'unsupervised';
    if ((runtime.launcherProtocol ?? 1) < REQUIRED_PROTOCOL) return 'launcher-too-old';
    if (opts.stageImpl) return null; // injected staging carries its own npm story
    npmProbe ??= findNpm() !== null;
    return npmProbe ? null : 'no-npm';
  };

  const updateStatus = async (force = false) => {
    const r = await updates.check(force);
    const kind = r.latest ? classify(meta.version, r.latest) : null;
    const apply = effectiveApply();
    return {
      enabled: updates.enabled(),
      current: meta.version,
      latest: r.latest,
      available: kind !== null,
      kind,
      // Pre-1.0, release-please folds breaking changes into minors
      // (bump-minor-pre-major), so only a real major asks for attention.
      attention: kind === 'major',
      checkedAt: r.checkedAt,
      notesUrl: r.latest && ghSlug ? `https://github.com/${ghSlug}/releases/tag/v${r.latest}` : null,
      error: apply.phase === 'error' ? apply.error : r.error,
      canApply: blockReason() === null,
      blockReason: blockReason(),
      phase: apply.phase,
      stagedVersion: apply.version,
    };
  };

  app.get('/api/update/status', async () => updateStatus());
  app.post('/api/update/check', async () => updateStatus(true));

  app.post('/api/update/apply', async (_req, reply) => {
    // Never over live work: a restart mid-generation is the one way this
    // system could cost someone an image.
    const busy = runningGenerations.size + runningImportCount() + runningAssetBuildCount();
    if (busy > 0) {
      return reply.status(409).send({ error: `work is still running (${busy} task${busy === 1 ? '' : 's'})` });
    }
    const block = blockReason();
    if (block)
      return reply.status(409).send({ error: `one-click update cannot run here (${block})`, blockReason: block });
    if (applyState.phase === 'staging') return reply.status(409).send({ error: 'an update is already staging' });

    const r = await updates.check();
    const kind = r.latest ? classify(meta.version, r.latest) : null;
    if (!r.latest || kind === null) return reply.status(409).send({ error: 'nothing newer to install' });

    const target = r.latest;
    applyState = { phase: 'staging', version: target, error: null };
    void (opts.stageImpl ?? stageVersion)({
      home: core.home,
      pkg: meta.name,
      source: { version: target },
      keep: new Set([meta.version]),
    })
      .then((res) => {
        applyState = res.ok
          ? { phase: 'ready', version: res.version, error: null }
          : { phase: 'error', version: null, error: `${res.reason}: ${res.detail}` };
      })
      .catch((err) => {
        applyState = { phase: 'error', version: null, error: String((err as Error)?.message ?? err) };
      });
    return { ok: true, staging: target };
  });

  app.post('/api/update/restart', async (_req, reply) => {
    const apply = effectiveApply();
    if (apply.phase !== 'ready') return reply.status(409).send({ error: 'no staged update to restart into' });
    if (!runtime.supervised) {
      return reply.status(409).send({ error: 'not supervised — restart scenri yourself', blockReason: 'unsupervised' });
    }
    // Answer first, then go: the browser needs this reply to start its
    // reconnect overlay before the socket disappears.
    reply.send({ ok: true });
    const exit = opts.exitImpl ?? ((code: number) => process.exit(code));
    setTimeout(() => {
      let done = false;
      setTimeout(() => {
        if (!done) exit(75);
      }, 5000).unref();
      void app
        .drain()
        .then(() => {
          done = true;
          exit(75);
        })
        .catch(() => {
          done = true;
          exit(75);
        });
    }, 50);
  });
  // ---- what's new: the version this build IS, from data shipped inside it.
  // Deliberately not the update routes' business. Those answer "there is a
  // newer scenri" and ask you to act; this one answers "here is what you got"
  // and asks nothing. Fusing them is what made the old notes route describe a
  // version the user did not have, then vanish the moment they installed it.
  app.get('/api/release/notes', async () => {
    // A fresh install must not open a modal explaining changes to someone who
    // has never seen the app. The first boot of a new home stamps both keys,
    // so `seen` already equals the running version and nothing pops. The cost
    // is one-time and known: the release that introduces this will not
    // announce itself on an install that predates the marker.
    if (!core.store.getSetting('install.firstVersion')) {
      core.store.setSetting('install.firstVersion', meta.version);
      core.store.setSetting('whatsnew.seen', meta.version);
    }
    return {
      version: meta.version,
      entry: releaseFor(meta.version),
      seen: core.store.getSetting('whatsnew.seen') || null,
      // 0.0.0 is the placeholder release-please has not bumped yet. No tag has
      // ever existed for it, and the releases index of a project that has not
      // released is an empty page, so there is nowhere honest to point: null.
      // Its absence is also what tells the dialog it is looking at a
      // development build rather than a release nobody wrote notes for.
      // Every other version a user can be running was published, and
      // publishing is what creates the tag.
      changelogUrl:
        ghSlug && meta.version !== UNRELEASED ? `https://github.com/${ghSlug}/releases/tag/v${meta.version}` : null,
      // Where everything before the three in the dialog lives. The index, not
      // a tag: this one is the archive, and it outlives the version running.
      // Gated on there being an archive at all, so a project that has never
      // published does not offer a link to an empty page. Never use it to
      // decide whether *this build* was released — `changelogUrl` answers that.
      releasesUrl: ghSlug && RELEASES.some(isNewsworthy) ? `https://github.com/${ghSlug}/releases` : null,
    };
  });

  app.post('/api/release/seen', async (req) => {
    // The version is the client's, not ours: it acknowledges what it was shown,
    // which is the version it loaded. Anything else and a restart mid-read
    // could mark the wrong release as read.
    const v = (req.body as { version?: unknown } | undefined)?.version;
    core.store.setSetting('whatsnew.seen', typeof v === 'string' && v ? v : meta.version);
    return { ok: true };
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
      await app.close();
      core.close();
    })();
    return drained;
  });

  app.get('/api/home', async () => {
    const imagesDir = join(core.home, 'images');
    let files = 0,
      bytes = 0;
    if (existsSync(imagesDir)) {
      for (const f of readdirSync(imagesDir)) {
        try {
          bytes += statSync(join(imagesDir, f)).size;
          files++;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
    const dbPath = join(core.home, 'scenri.db');
    const dbBytes = existsSync(dbPath) ? statSync(dbPath).size : 0;
    return { dir: core.home, dbPath, images: files, bytes: bytes + dbBytes };
  });

  /** Open the library in the OS file manager. Local app only, by nature. */
  app.post('/api/system/reveal', async (_req, reply) => {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    try {
      spawn(cmd, [core.home], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* headless box */
    }
    return reply.send({ ok: true });
  });

  /** Everything you made, as one zip. Never keys: those live in the settings table, which this never reads. */
  app.get('/api/export/all', async (_req, reply) => {
    const zip = new JSZip();
    const brands = core.store.listBrands();
    zip.file('brands.json', JSON.stringify(brands, null, 2));
    const seen = new Set<string>();
    for (const brand of brands) {
      for (const project of core.store.listProjects(brand.id)) {
        const tree = core.store.treeFor(project.id);
        zip.file(`projects/${project.id}/tree.json`, JSON.stringify({ project, nodes: tree }, null, 2));
        for (const node of tree) {
          for (const hash of node.images ?? []) {
            if (seen.has(hash) || !core.images.has(hash)) continue;
            seen.add(hash);
            zip.file(`images/${hash}.png`, core.images.read(hash));
          }
        }
      }
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', 'attachment; filename="scenri-library.zip"');
    return reply.send(buf);
  });

  /**
   * The danger zone. `shots` keeps brands, cast and scenes and only drops what
   * was generated; `all` empties the home directory. Scoped to SCENRI_HOME,
   * never a path from the request.
   */
  app.delete('/api/data', async (req, reply) => {
    const scope = String((req.query as any)?.scope ?? '');
    if (scope !== 'shots' && scope !== 'all') return reply.status(400).send({ error: 'scope must be shots or all' });
    if (scope === 'shots') {
      let removed = 0;
      for (const brand of core.store.listBrands()) {
        // the sets go with the shots: a set that survives a wipe is a name with
        // nothing behind it, which reads as work that quietly went missing
        for (const set of core.store.listSets(brand.id)) core.store.deleteSet(set.id);
        for (const project of core.store.listProjects(brand.id)) {
          core.store.deleteProject(project.id);
          removed++;
        }
      }
      return { ok: true, scope, projects: removed };
    }
    core.close();
    // User data by explicit name — never the whole home dir: ~/.scenri/app
    // holds the staged application versions, and one of them may be the code
    // answering this very request.
    for (const name of ['scenri.db', 'scenri.db-wal', 'scenri.db-shm', 'images', 'backups']) {
      rmSync(join(core.home, name), { recursive: true, force: true });
    }
    return { ok: true, scope };
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
