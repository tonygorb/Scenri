import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import {
  demoProductFacetsOf,
  demoProductRefPath,
  PRODUCT_ANGLES_BY_CATEGORY,
  primaryAngleFor,
  type DemoProduct,
} from '../demoProducts.js';
import type { ThumbStore } from '../thumbs.js';
import { fileKey, mtimeQS, serveJpeg, serveJpegSized } from './shared.js';

export function registerDemoProductRoutes(
  app: FastifyInstance,
  deps: {
    templatesRoot: string;
    demoProducts: DemoProduct[];
    demoProductById: (id: string) => DemoProduct | undefined;
    thumbs: ThumbStore;
  },
): void {
  const { templatesRoot, demoProducts, demoProductById, thumbs } = deps;
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
    if (!m) return reply.status(404).send({ error: 'no preview' });
    const path = demoProductThumbPath(m[1]);
    if (!path || !existsSync(path)) return reply.status(404).send({ error: 'no preview' });
    return serveJpegSized(req, reply, path, thumbs, fileKey('demo', m[1], path));
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
}
