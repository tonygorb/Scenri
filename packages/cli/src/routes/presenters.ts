import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { contentDirList, contentFile } from '../content/overlay.js';
import { presenterAvatarPath, presenterFacetsOf, presenterRefPath, type Presenter } from '../presenters.js';
import { mtimeQS, serveJpeg } from './shared.js';

export function registerPresenterRoutes(
  app: FastifyInstance,
  deps: { templatesRoot: string; presenters: Presenter[] },
): void {
  const { templatesRoot, presenters } = deps;
  const presenterThumbPath = (id: string) => contentFile(templatesRoot, 'previews', 'presenters', `${id}.jpg`);
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
    const frames = contentDirList(templatesRoot, 'previews', 'presenters', id)
      .map((f) => /^(ref-[0-9]{2})\.jpg$/.exec(f)?.[1])
      .filter((slot): slot is string => !!slot)
      .map((slot) => `/api/presenter-previews/${id}/${slot}.jpg${mtimeQS(presenterRefPath(templatesRoot, id, slot))}`);
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
}
