import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { contentDirList, contentFile } from '../content/overlay.js';
import { facetsOf, type Scene } from '../scenes.js';
import { vibrantColor } from '../swatch.js';
import type { ThumbStore } from '../thumbs.js';
import { fileKey, mtimeQS, serveJpeg, serveJpegSized } from './shared.js';

export function registerSceneRoutes(
  app: FastifyInstance,
  deps: { templatesRoot: string; scenes: Scene[]; thumbs: ThumbStore },
): void {
  const { templatesRoot, scenes, thumbs } = deps;
  const previewPath = (id: string) => contentFile(templatesRoot, 'previews', `${id}.jpg`);
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
  app.get('/api/scene-thumbnails/:file', async (req, reply) => {
    const m = /^([a-z0-9-]+)\.jpg$/.exec(String((req.params as any).file));
    if (!m || !existsSync(previewPath(m[1]))) return reply.status(404).send({ error: 'no preview' });
    // `?w=` for the cards and the picker: a 720px preview is 90 KB, a page of them 4 MB
    const path = previewPath(m[1]);
    return serveJpegSized(req, reply, path, thumbs, fileKey('scene', m[1], path));
  });
  // A scene's reference set: several frames sharing one light, one per subject.
  // Both segments are pattern-guarded, so nothing outside previews/ is reachable.
  const refPath = (id: string, slot: string) => contentFile(templatesRoot, 'previews', id, `${slot}.jpg`);
  /** Which reference frames a scene actually has. One ask, instead of probing. */
  app.get('/api/scene-previews/:id', async (req, reply) => {
    const id = /^[a-z0-9-]+$/.exec(String((req.params as any).id))?.[0];
    if (!id) return reply.status(400).send({ error: 'bad scene id' });
    const frames = contentDirList(templatesRoot, 'previews', id)
      .filter((f) => /^ref-[0-9]{2}\.jpg$/.test(f))
      .map((f) => `/api/scene-previews/${id}/${f}${mtimeQS(contentFile(templatesRoot, 'previews', id, f))}`);
    return { frames };
  });
  app.get('/api/scene-previews/:id/:file', async (req, reply) => {
    const p = req.params as any;
    const id = /^[a-z0-9-]+$/.exec(String(p.id))?.[0];
    const slot = /^(ref-[0-9]{2})\.jpg$/.exec(String(p.file))?.[1];
    if (!id || !slot || !existsSync(refPath(id, slot))) return reply.status(404).send({ error: 'no frame' });
    return serveJpeg(req, reply, refPath(id, slot));
  });
}
