import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { contentFile } from '../content/overlay.js';
import { loadShowcase, showcaseFacetsOf, type ShowcaseEntry } from '../showcase.js';
import { mtimeQS, serveJpeg } from './shared.js';

export function registerShowcaseRoutes(app: FastifyInstance, deps: { templatesRoot: string }): void {
  const { templatesRoot } = deps;
  // ---- showcase (curated homepage gallery). Each entry is a real recipe —
  // the exact brief.tokens that produced its hero image — so opening one
  // reproduces the identical chips, ready to remix.
  const { showcase } = loadShowcase(join(templatesRoot, 'showcase'));
  const showcaseHeroPath = (id: string) => contentFile(templatesRoot, 'previews', 'showcase', `${id}.jpg`);
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
}
