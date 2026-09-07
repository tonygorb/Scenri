import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';
import type { ProductDraft } from '@scenri/engine-codex';
import type { Analyzer } from '../customAssets.js';
import { PRODUCT_ANGLES_BY_CATEGORY } from '../demoProducts.js';
import type { EngineRegistry } from '../engines.js';
import { plannedViews } from '../productPlan.js';

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
  deps: { core: Core; engines: EngineRegistry; analyzer?: Analyzer | null },
): void {
  const { core, analyzer } = deps;

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
}
