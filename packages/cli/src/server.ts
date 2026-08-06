import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { loadLooks, lookResolver, facetsOf, composePrompt, defaultLooksDir, type Look } from './looks.js';
import { compileBrief, FORMATS, type Brief } from './brief.js';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';
import { basename, join } from 'node:path';
import type { Core, EngineAdapter, GenerateRequest, EditRequest, BrandContext } from '@scenri/core';
import { SpendCapError } from '@scenri/core';
import { validateBrand, buildFromUrl } from '@scenri/brand';
import type { EngineRegistry } from './engines.js';
import { driftDiff } from './diff.js';
import { vibrantColor } from './swatch.js';
import { buildExportZip, EXPORT_PRESETS } from './exportPack.js';
import {
  startCatalogImport,
  cancelCatalogImport,
  brandJsonWithCatalogProducts,
  resolveLibraryProduct,
} from './catalogImport.js';
import { registerAccessGuard, type AccessOptions } from './access.js';

export interface ServerOptions {
  core: Core;
  engines: EngineRegistry;
  studioDist?: string; // path to built SPA; optional in tests
  fetchImpl?: typeof fetch;
  templatesDir?: string; // override for tests
  access?: AccessOptions; // host allowlist + LAN token; loopback-only by default
}

/** Settings keys exposed via the API. Secrets are write-only: reads return booleans. */
const SECRET_KEYS = ['openrouter_api_key', 'replicate_api_token', 'fal_key'];

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

export function buildServer(opts: ServerOptions): FastifyInstance {
  const { core, engines } = opts;
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
  const { looks } = loadLooks(opts.templatesDir);
  // resolves a look by its id or by any id it used to answer to
  const resolveLook = lookResolver(looks);
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
      saveAsset: async (buf) => `asset:${core.images.save(buf)}`,
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

  // ---- products (photos inside the brand kit)
  // Products and cast are the same shape: a named thing with a locked photo.
  // One pair of handlers, two collections, so they cannot drift apart.
  const ASSETS = {
    products: { key: 'products', prefix: 'p', fallback: 'Product' },
    characters: { key: 'characters', prefix: 'c', fallback: 'Someone' },
  } as const;
  const addAsset = (kind: keyof typeof ASSETS) => async (req: any, reply: any) => {
    const spec = ASSETS[kind];
    const brand = core.store.getBrand(req.params.id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const part = await req.file();
    if (!part) return reply.status(400).send({ error: 'multipart file field required' });
    const buf: Buffer = await part.toBuffer();
    if (buf.length === 0) return reply.status(400).send({ error: 'empty file' });
    const png = await sharp(buf).png().toBuffer(); // normalize any input format
    const hash = core.images.save(png);
    const name = String(part.fields?.name?.value ?? part.filename ?? spec.fallback).slice(0, 80);
    const json = { ...(brand.json as any) };
    json[spec.key] = [
      ...(json[spec.key] ?? []),
      { id: `${spec.prefix}-${randomUUID().slice(0, 8)}`, name, shots: [{ file: `asset:${hash}`, locked: true }] },
    ];
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
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
  app.post('/api/brands/:id/characters', addAsset('characters'));
  app.delete('/api/brands/:id/characters/:assetId', removeAsset('characters'));

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

  // ---- looks (+ their preview imagery when generated)
  const templatesRoot = opts.templatesDir ?? defaultLooksDir();
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
  const decorate = async (l: Look) => ({
    ...l,
    previewUrl: existsSync(previewPath(l.id)) ? `/api/template-previews/${l.id}.jpg` : null,
    previewColor: await previewColor(l.id),
  });
  app.get('/api/looks', async () => ({
    looks: await Promise.all(looks.map(decorate)),
    ...facetsOf(looks),
  }));
  /** @deprecated kept one release so stored briefs and outside callers keep resolving. */
  app.get('/api/templates', async () => Promise.all(looks.map(decorate)));
  // A generated look's own jpg can be regenerated at the same filename (a
  // rejected preview, redone), so a long max-age alone would leave a stale
  // copy in every browser cache for up to a day. An mtime-based ETag lets
  // the cache stay long while still revalidating the moment the file changes.
  const serveJpeg = (req: FastifyRequest, reply: FastifyReply, path: string) => {
    const etag = `"${statSync(path).mtimeMs}"`;
    reply.header('cache-control', 'public, max-age=86400, must-revalidate').header('etag', etag);
    if (req.headers['if-none-match'] === etag) return reply.status(304).send();
    return reply.header('content-type', 'image/jpeg').send(readFileSync(path));
  };
  app.get('/api/template-previews/:file', async (req, reply) => {
    const m = /^([a-z0-9-]+)\.jpg$/.exec(String((req.params as any).file));
    if (!m || !existsSync(previewPath(m[1]))) return reply.status(404).send({ error: 'no preview' });
    return serveJpeg(req, reply, previewPath(m[1]));
  });
  // A look's reference set: several frames sharing one light, one per subject.
  // Both segments are pattern-guarded, so nothing outside previews/ is reachable.
  const refPath = (id: string, slot: string) => join(templatesRoot, 'previews', id, `${slot}.jpg`);
  /** Which reference frames a look actually has. One ask, instead of probing. */
  app.get('/api/look-previews/:id', async (req, reply) => {
    const id = /^[a-z0-9-]+$/.exec(String((req.params as any).id))?.[0];
    if (!id) return reply.status(400).send({ error: 'bad look id' });
    const dir = join(templatesRoot, 'previews', id);
    if (!existsSync(dir)) return { frames: [] };
    const frames = readdirSync(dir)
      .filter((f) => /^ref-[0-9]{2}\.jpg$/.test(f))
      .sort()
      .map((f) => `/api/look-previews/${id}/${f}`);
    return { frames };
  });
  app.get('/api/look-previews/:id/:file', async (req, reply) => {
    const p = req.params as any;
    const id = /^[a-z0-9-]+$/.exec(String(p.id))?.[0];
    const slot = /^(ref-[0-9]{2})\.jpg$/.exec(String(p.file))?.[1];
    if (!id || !slot || !existsSync(refPath(id, slot))) return reply.status(404).send({ error: 'no frame' });
    return serveJpeg(req, reply, refPath(id, slot));
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
    const compiled = compileBrief(brief as Brief, {
      brand: brandJsonWithCatalogProducts(core, brand.id),
      images: core.images,
      engineCaps: engine.capabilities(),
      template: brief.templateId ? resolveLook(String(brief.templateId)) : undefined,
      templateById: (id: string) => resolveLook(id),
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
      const free = perGeneration <= 0;
      const generationsLeft = free || cap === null ? null : Math.max(0, Math.floor((cap - spend) / perGeneration));
      const generationsTotal = free || cap === null ? null : Math.max(0, Math.floor(cap / perGeneration));
      list.push({
        ...caps,
        available: avail.ok,
        reason: avail.reason ?? null,
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
    return out;
  });
  app.put('/api/settings', async (req) => {
    const body = req.body as Record<string, string>;
    for (const k of SECRET_KEYS) if (typeof body[k] === 'string') core.store.setSetting(k, body[k]);
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

  async function runNode(
    nodeId: string,
    engine: EngineAdapter,
    estimate: number,
    work: (signal: AbortSignal) => Promise<{ images: string[]; costUsd: number }>,
  ) {
    const engineId = engine.capabilities().id;
    reserved.set(engineId, (reserved.get(engineId) ?? 0) + estimate);
    const ctrl = new AbortController();
    runningGenerations.set(nodeId, ctrl);
    try {
      const result = await work(ctrl.signal);
      result.images = await normalizePngs(result.images);
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
      compiled = compileBrief(brief as Brief, {
        brand: brandJsonWithCatalogProducts(core, project.brandId),
        images: core.images,
        engineCaps: engine.capabilities(),
        template: brief.templateId ? resolveLook(String(brief.templateId)) : undefined,
        templateById: (id: string) => resolveLook(id),
      });
      if (!compiled.prompt.trim()) return reply.status(400).send({ error: 'the brief is empty' });
    }

    // template + product resolution
    let finalPrompt = String(prompt ?? '');
    let referenceImages: string[] | undefined;
    let product: any = null;
    if (productId) {
      product = resolveLibraryProduct(core, project.brandId, String(productId));
      if (!product) return reply.status(400).send({ error: 'product not found in brand' });
      referenceImages = (product.shots ?? [])
        .map((s: any) => String(s.file ?? ''))
        .filter((f: string) => f.startsWith('asset:') && core.images.has(f.slice(6)))
        .map((f: string) => core.images.pathFor(f.slice(6)));
      if (!referenceImages || referenceImages.length === 0)
        return reply.status(400).send({ error: 'product has no usable shots' });
    }
    let template: Look | undefined;
    if (templateId) {
      template = resolveLook(String(templateId));
      if (!template) return reply.status(400).send({ error: `unknown template ${templateId}` });
      if (template.subject === 'product' && !product)
        return reply
          .status(400)
          .send({ error: `look "${template.name}" needs a product — add one via Products and select it` });
      const subject = product?.name ? `${product.name} ` : '';
      finalPrompt = `[${template.name}] ${subject}${composePrompt(template, { fields: templateFields ?? {}, notes: String(prompt ?? '') })}`;
      width = template.width;
      height = template.height;
    }

    let estimate: number;
    let work: (signal: AbortSignal) => Promise<{ images: string[]; costUsd: number }>;

    if (compiled) {
      finalPrompt = compiled.prompt;
      referenceImages = compiled.referenceImages;
      width = compiled.width;
      height = compiled.height;
    }

    if (kind === 'generation') {
      const cap = engine.capabilities().maxReferenceImages;
      const genReq: GenerateRequest = {
        prompt: finalPrompt,
        brand: ctx,
        width: Number(width),
        height: Number(height),
        count: Math.min(Math.max(1, Number(count)), 8),
        ...(referenceImages && cap > 0 ? { referenceImages: referenceImages.slice(0, cap) } : {}),
      };
      estimate = await engine.costEstimate(genReq);
      work = (signal) => engine.generate(genReq, signal);
    } else {
      const parent = core.store.getNode(resolvedParentId);
      const srcHash = (req.body as any).sourceImage ?? parent?.images[0];
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
    if (brief) core.store.setBrief(node.id, brief);
    // Fire and forget: the 202 is the answer and the node's own status carries
    // the outcome. runNode records failures itself, so a rejection here means
    // even that failed — log it, but never let it reach the process unhandled.
    void runNode(node.id, engine, estimate, work).catch((err) => app.log.error({ err }, 'node run failed'));
    return reply.status(202).send(node);
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

  /** Everything you made, as one zip. Never keys: those live in config.json. */
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
   * The danger zone. `shots` keeps brands, cast and looks and only drops what
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
    rmSync(core.home, { recursive: true, force: true });
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
      reply.header('content-type', 'text/html').send(readFileSync(`${dist}/index.html`, 'utf8'));
    });
  }

  return app;
}
