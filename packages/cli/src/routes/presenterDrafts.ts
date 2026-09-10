import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  approveView,
  createPresenterDraft,
  discardPresenterDraft,
  generateView,
  getPresenterDraft,
  listPresenterDrafts,
  openPresenterEdit,
  redoView,
  restoreView,
  stopPresenterDraft,
  revertView,
  savePresenterDraft,
  updatePresenterDraft,
  usePhotoForView,
  type PresenterDraftRecord,
} from '../presenterDrafts.js';
import type { PresenterView } from '../presenterPrompts.js';
import type { ThumbStore } from '../thumbs.js';
import { makeBuildDeps, type BuildRouteDeps } from './assetBuilds.js';

/**
 * The presenter studio's API. A draft is created from a sentence or from
 * photographs, its views are drawn and decided one at a time (the three core
 * ones by default, the extras once the row asks for them), and the save is a
 * presenter like any other. Every answer is the whole draft, so the dialog
 * never has to merge.
 */
export function registerPresenterDraftRoutes(
  app: FastifyInstance,
  deps: BuildRouteDeps & { thumbs: ThumbStore },
): void {
  const { core, thumbs } = deps;
  const { buildDeps } = makeBuildDeps(deps);
  const hooks = { evict: (hash: string) => thumbs.evict(hash) };

  const brandOr404 = (req: FastifyRequest, reply: FastifyReply) => {
    const brand = core.store.getBrand(String((req.params as any).id));
    if (!brand) {
      reply.status(404).send({ error: 'brand not found' });
      return null;
    }
    return brand;
  };
  const draftOr404 = (req: FastifyRequest, reply: FastifyReply): PresenterDraftRecord | null => {
    const brand = brandOr404(req, reply);
    if (!brand) return null;
    const draft = getPresenterDraft(core, String((req.params as any).draftId));
    if (!draft || draft.brandId !== brand.id) {
      reply.status(404).send({ error: 'draft not found' });
      return null;
    }
    return draft;
  };
  /** Errors carry their status; anything without one is a 500. */
  const answer = async <T>(reply: FastifyReply, work: () => Promise<T>) => {
    try {
      return await work();
    } catch (err: any) {
      return reply.status(err?.statusCode ?? 500).send({ error: err?.message ?? 'something went wrong' });
    }
  };
  const viewOf = (req: FastifyRequest) => String((req.params as any).view) as PresenterView;

  app.post('/api/brands/:id/presenter-drafts', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const body = (req.body ?? {}) as any;
    return answer(reply, async () =>
      createPresenterDraft(await buildDeps(), {
        brandId: brand.id,
        source: body.source === 'synthetic' ? 'synthetic' : 'photos',
        direction: body.direction == null ? undefined : String(body.direction),
        keep: body.keep == null ? undefined : String(body.keep),
        detailRefs: body.detailRefs,
        imageHashes: Array.isArray(body.imageHashes) ? body.imageHashes.map((h: unknown) => String(h)) : [],
        attestation: body.attestation === true,
        name: body.name == null ? undefined : String(body.name),
        facets: Array.isArray(body.facets) ? body.facets.map((f: unknown) => String(f)) : [],
        extras: body.extras === true,
      }),
    );
  });
  app.get('/api/brands/:id/presenter-drafts', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    return { drafts: listPresenterDrafts(core, brand.id) };
  });
  /**
   * Edit a saved person: the session already open on them, else one seeded
   * from the record. Any id in their history opens the head, and the rows
   * above carry `presenterId` so a client can find the session again.
   */
  app.post('/api/brands/:id/presenters/:presenterId/edit', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    return answer(reply, async () => openPresenterEdit(core, brand.id, String((req.params as any).presenterId)));
  });
  app.get('/api/brands/:id/presenter-drafts/:draftId', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    return draft;
  });
  app.patch('/api/brands/:id/presenter-drafts/:draftId', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    const body = (req.body ?? {}) as any;
    return answer(reply, () =>
      updatePresenterDraft(core, draft.id, {
        name: body.name,
        facets: body.facets,
        direction: body.direction,
        keep: body.keep,
        detailRefs: body.detailRefs,
        extras: body.extras,
      }),
    );
  });
  app.post('/api/brands/:id/presenter-drafts/:draftId/views/:view/generate', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    const body = (req.body ?? {}) as any;
    return answer(reply, async () =>
      generateView(await buildDeps(), draft.id, viewOf(req), {
        adjustment: body.adjustment == null ? undefined : String(body.adjustment),
        decide: body.decide === 'auto' ? 'auto' : undefined,
      }),
    );
  });
  app.post('/api/brands/:id/presenter-drafts/:draftId/views/:view/approve', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    return answer(reply, async () => approveView(await buildDeps(), draft.id, viewOf(req)));
  });
  app.post('/api/brands/:id/presenter-drafts/:draftId/views/:view/redo', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    return answer(reply, async () => redoView(await buildDeps(), draft.id, viewOf(req)));
  });
  app.post('/api/brands/:id/presenter-drafts/:draftId/views/:view/revert', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    return answer(reply, async () => revertView(await buildDeps(), draft.id, viewOf(req)));
  });
  app.post('/api/brands/:id/presenter-drafts/:draftId/views/:view/restore', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    const hash = String((req.body as { hash?: unknown } | null)?.hash ?? '');
    return answer(reply, async () => restoreView(await buildDeps(), draft.id, viewOf(req), hash));
  });
  app.post('/api/brands/:id/presenter-drafts/:draftId/views/:view/use-photo', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    const body = (req.body ?? {}) as any;
    return answer(reply, async () =>
      usePhotoForView(await buildDeps(), draft.id, viewOf(req), String(body.hash ?? '')),
    );
  });
  app.post('/api/brands/:id/presenter-drafts/:draftId/save', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    return answer(reply, async () => savePresenterDraft(await buildDeps(), draft.id, hooks));
  });
  app.post('/api/brands/:id/presenter-drafts/:draftId/stop', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    return answer(reply, async () => stopPresenterDraft(await buildDeps(), draft.id));
  });
  app.delete('/api/brands/:id/presenter-drafts/:draftId', async (req, reply) => {
    const draft = draftOr404(req, reply);
    if (!draft) return;
    return answer(reply, async () => {
      await discardPresenterDraft(await buildDeps(), draft.id, hooks);
      return { ok: true };
    });
  });
}
