import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { Core } from '@scenri/core';
import { validateBrand } from '@scenri/brand';
import { assetHash, LOGO_BACKGROUNDS, LOGO_ROLES, readImagePart, toMarkPng } from './shared.js';

export function registerLogoRoutes(app: FastifyInstance, deps: { core: Core }): void {
  const { core } = deps;
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
    const part = await readImagePart(core, req, toMarkPng);
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
    // One primary at a time. The studio, the nav avatar and the setup screen
    // all ask "which is THE logo", and two entries answering it differently is
    // how the wrong mark reaches a prompt. Promoting one demotes the incumbent.
    json.logos =
      role === 'primary'
        ? logos.map((l) => (l !== entry && l?.role === 'primary' ? { ...l, role: 'alternate' } : l))
        : logos;
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    const row = core.store.updateBrand(brand.id, json);
    // The client cannot compute the normalized content hash itself — the
    // stored PNG is the upload after toMarkPng — so the answer names the mark
    // it just made, riding beside the row the way `productId` does elsewhere.
    // The long edge rides too, so the caller can warn about a tiny source.
    const meta = await sharp(core.images.read(part.hash))
      .metadata()
      .catch(() => null);
    const logoEdge = meta ? Math.max(meta.width ?? 0, meta.height ?? 0) || null : null;
    return { ...row, logoHash: part.hash, logoEdge };
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
      // Promoting this mark to primary demotes the incumbent: the kit holds
      // one primary at a time (see the POST above for why).
      if (i !== idx) return patch.role === 'primary' && l?.role === 'primary' ? { ...l, role: 'alternate' } : l;
      const next = { ...l, ...patch };
      if ('clearSpace' in body && !patch.clearSpace) delete next.clearSpace;
      return next;
    });
    const v = validateBrand(json);
    if (!v.valid) return reply.status(400).send({ error: 'brand became invalid', details: v.errors });
    return core.store.updateBrand(brand.id, json);
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
}
