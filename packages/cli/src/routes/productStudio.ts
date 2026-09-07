import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';
import { createCodexAnalyzer, type ProductDraft } from '@scenri/engine-codex';
import type { Analyzer } from '../customAssets.js';
import { PRODUCT_ANGLES_BY_CATEGORY } from '../demoProducts.js';
import type { EngineRegistry } from '../engines.js';
import {
  abandonDraft,
  cancelCandidate,
  getCandidate,
  keepCandidate,
  rejectCandidate,
  startCandidate,
  type CandidateDeps,
} from '../productCandidates.js';
import { plannedViews } from '../productPlan.js';
import type { ThumbStore } from '../thumbs.js';
import { brandContext, pickBuildEngine } from './shared.js';

/**
 * The product studio's server half.
 *
 * A product is established from photographs. One read turns them into the
 * identity sheet demo products have always shipped, labels each photograph's
 * angle, says when they disagree, and plans the views the photographs do not
 * cover. Everything here is decided before a product exists: the studio
 * holds the answer in its draft and saves one product at the end, through
 * the same write every product has always used.
 */
export function registerProductStudioRoutes(
  app: FastifyInstance,
  deps: { core: Core; engines: EngineRegistry; analyzer?: Analyzer | null; thumbs?: ThumbStore | null },
): void {
  const { core, engines, thumbs } = deps;
  // The same reader the asset builds use: injected in tests, the local Codex CLI otherwise.
  const analyzer: Analyzer | null = deps.analyzer ?? createCodexAnalyzer({ runner: engines.codexRunner });

  const candidateDeps = async (): Promise<CandidateDeps> => ({
    core,
    engine: await pickBuildEngine(engines),
    analyzer: null,
    brandContext: (brandId: string) => brandContext(core, brandId),
    vocabulary: { collections: [], verticals: [], categories: [] },
    thumbs: thumbs ?? null,
  });

  const sendError = (reply: any, err: any) =>
    reply.status(err?.statusCode ?? 500).send({ error: err?.message ?? 'failed' });

  const brandOr404 = (req: any, reply: any) => {
    const brand = core.store.getBrand(String(req.params.id));
    if (!brand) {
      reply.status(404).send({ error: 'brand not found' });
      return null;
    }
    return brand;
  };

  /** Hashes that are really in the store, or the one reason they are not. */
  const imageHashes = (body: any): { hashes: string[] } | { error: string } => {
    const raw = Array.isArray(body?.imageHashes) ? body.imageHashes.map((h: unknown) => String(h)) : [];
    if (raw.length === 0) return { error: 'at least one photograph is required' };
    for (const h of raw) {
      if (!/^[a-f0-9]{32}$/.test(h) || !core.images.has(h)) return { error: `unknown image ${h}` };
    }
    return { hashes: raw };
  };

  const vocabulary = () => {
    const productCategories = Object.keys(PRODUCT_ANGLES_BY_CATEGORY);
    const angleKeys = [...new Set(Object.values(PRODUCT_ANGLES_BY_CATEGORY).flat())];
    return { productCategories, angleKeys };
  };

  /**
   * Read the photographs. The answer is always shaped the same: with no
   * analyzer the sheet is null, every angle is "other", and the plan is what
   * the fallback category asks for, so the studio never has to branch on why.
   */
  app.post('/api/brands/:id/product-studio/analyze', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const picked = imageHashes(req.body);
    if ('error' in picked) return reply.status(400).send({ error: picked.error });
    const { hashes } = picked;

    const probe = analyzer ? await analyzer.isAvailable() : { ok: false as const, reason: 'Codex is not installed' };
    if (!probe.ok) {
      const angles = hashes.map(() => 'other');
      return {
        available: false,
        reason: probe.reason ?? 'Codex is not installed',
        sheet: null,
        angles,
        conflict: '',
        coverage: [],
        plan: plannedViews(null, angles),
      };
    }

    const draft = (await analyzer!.analyze({
      kind: 'product',
      imagePaths: hashes.map((h) => core.images.pathFor(h)),
      name: String(req.body && (req.body as any).name ? (req.body as any).name : '').slice(0, 80),
      vocabulary: vocabulary(),
    })) as ProductDraft;
    const { angles, conflict, coverage, ...sheet } = draft;
    return {
      available: true,
      sheet,
      angles,
      conflict,
      coverage,
      plan: plannedViews(sheet.category, angles),
    };
  });

  /* ---------------------------------------------------------- candidates */

  const candidateOr404 = (req: any, reply: any) => {
    const c = getCandidate(String(req.params.jobId));
    if (!c || c.brandId !== String(req.params.id)) {
      reply.status(404).send({ error: 'candidate not found' });
      return null;
    }
    return c;
  };

  /** Draw one view. Answers the moment the work is queued; the studio polls the record. */
  app.post('/api/brands/:id/product-studio/candidates', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const body = (req.body ?? {}) as any;
    const photos = Array.isArray(body.photoHashes) ? body.photoHashes.map((h: unknown) => String(h)) : [];
    const kept = Array.isArray(body.keptHashes) ? body.keptHashes.map((h: unknown) => String(h)) : [];
    try {
      const made = startCandidate(await candidateDeps(), {
        brandId: brand.id,
        draftId: String(body.draftId ?? 'draft'),
        angle: String(body.angle ?? ''),
        photoHashes: photos,
        keptHashes: kept,
        sheet: body.sheet && typeof body.sheet === 'object' ? body.sheet : null,
        correction: body.correction == null ? null : String(body.correction),
        attempt: Number(body.attempt ?? 1),
      });
      return reply.status(202).send(made);
    } catch (err: any) {
      return sendError(reply, err);
    }
  });
  app.get('/api/brands/:id/product-studio/candidates/:jobId', async (req, reply) => {
    if (!brandOr404(req, reply)) return;
    const c = candidateOr404(req, reply);
    if (!c) return;
    return c;
  });
  app.post('/api/brands/:id/product-studio/candidates/:jobId/keep', async (req, reply) => {
    if (!brandOr404(req, reply)) return;
    const c = candidateOr404(req, reply);
    if (!c) return;
    try {
      return { candidate: keepCandidate(c.id) };
    } catch (err: any) {
      return sendError(reply, err);
    }
  });
  app.post('/api/brands/:id/product-studio/candidates/:jobId/reject', async (req, reply) => {
    if (!brandOr404(req, reply)) return;
    const c = candidateOr404(req, reply);
    if (!c) return;
    try {
      return { candidate: rejectCandidate(await candidateDeps(), c.id) };
    } catch (err: any) {
      return sendError(reply, err);
    }
  });
  app.post('/api/brands/:id/product-studio/candidates/:jobId/cancel', async (req, reply) => {
    if (!brandOr404(req, reply)) return;
    const c = candidateOr404(req, reply);
    if (!c) return;
    cancelCandidate(c.id);
    return { ok: true };
  });
  /** The draft is over without a save: every view it drew and did not hand to a product goes. */
  app.delete('/api/brands/:id/product-studio/drafts/:draftId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const removed = abandonDraft(await candidateDeps(), brand.id, String((req.params as any).draftId));
    return { ok: true, removed };
  });
}
