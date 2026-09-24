import { existsSync, readFileSync } from 'node:fs';
import type { Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { contentDirList, contentFile } from '../content/overlay.js';
import { facetsOf, isSceneView, SCENE_VIEW_SLOTS, type Scene, slotOfView } from '../scenes.js';
import { vibrantColor } from '../swatch.js';
import type { ThumbStore } from '../thumbs.js';
import { fileKey, mtimeQS, serveJpegSized } from './shared.js';

export function registerSceneRoutes(
  app: FastifyInstance,
  deps: { templatesRoot: string; scenes: Scene[]; thumbs: ThumbStore; core: Core },
): void {
  const { templatesRoot, scenes, thumbs, core } = deps;
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
    const files = contentDirList(templatesRoot, 'previews', id).filter((f) => /^ref-[0-9]{2}\.jpg$/.test(f));
    const url = (f: string) =>
      `/api/scene-previews/${id}/${f}${mtimeQS(contentFile(templatesRoot, 'previews', id, f))}`;
    // Each frame by what it shows, so the page names it and a cover or a pick
    // can say which one it means without counting.
    const views = files.flatMap((f) => {
      const view = SCENE_VIEW_SLOTS[f.replace(/\.jpg$/, '')];
      return view ? [{ view, url: url(f) }] : [];
    });
    return { frames: files.map(url), views };
  });
  /**
   * One of a catalog scene's views, as a picture a shot can be handed (Use
   * this view). Its frames live in Scenri's downloaded library, not in the
   * image store a brief reads, so the one asked for is copied in and its hash
   * answered; the store is content-addressed, so asking twice keeps one copy.
   */
  app.post('/api/scenes/:id/views/:view/pick', async (req, reply) => {
    const p = req.params as any;
    const id = /^[a-z0-9-]+$/.exec(String(p.id))?.[0];
    const view = isSceneView(p.view) ? p.view : null;
    const slot = view ? slotOfView(view) : null;
    if (!id || !scenes.some((s) => s.id === id)) return reply.status(404).send({ error: 'scene not found' });
    if (!slot || !existsSync(refPath(id, slot)))
      return reply.status(404).send({ error: 'this scene has no such view' });
    const hash = core.images.save(
      await sharp(readFileSync(refPath(id, slot)))
        .png()
        .toBuffer(),
    );
    return { hash };
  });
  app.get('/api/scene-previews/:id/:file', async (req, reply) => {
    const p = req.params as any;
    const id = /^[a-z0-9-]+$/.exec(String(p.id))?.[0];
    const slot = /^(ref-[0-9]{2})\.jpg$/.exec(String(p.file))?.[1];
    if (!id || !slot || !existsSync(refPath(id, slot))) return reply.status(404).send({ error: 'no frame' });
    // `?w=` too: a brand that shows one of these as its cover shows it on every card
    const path = refPath(id, slot);
    return serveJpegSized(req, reply, path, thumbs, fileKey('scene-frame', `${id}-${slot}`, path));
  });
}
