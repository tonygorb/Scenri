import type { Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import type { ProductSizes } from '../productSizes.js';

/** A product as a size is read from: its name, its record's own words, its first photograph. */
export interface SizedProduct {
  id: string;
  name: string;
  dimensions?: unknown;
  description?: string;
  photo: string | null;
}

/**
 * A product's real size, as its page shows it.
 *
 * GET answers with the size that holds, reading it from the photograph the
 * first time anyone looks, so the page shows a size without anyone having been
 * asked for one. PUT is the page's own correction: words with a unit ("2 cm",
 * "30 x 20 cm"), or nothing to take the correction back.
 */
export function registerProductSizeRoutes(
  app: FastifyInstance,
  deps: {
    core: Core;
    sizes: ProductSizes;
    productFor: (brandId: string, productId: string) => Promise<SizedProduct | null>;
  },
): void {
  const { core, sizes, productFor } = deps;
  const find = async (params: unknown) => {
    const { id, productId } = params as { id: string; productId: string };
    if (!core.store.getBrand(id)) return null;
    const product = await productFor(id, String(productId));
    return product ? { brandId: id, product } : null;
  };

  app.get('/api/brands/:id/products/:productId/size', async (req, reply) => {
    const found = await find(req.params);
    if (!found) return reply.status(404).send({ error: 'product not found' });
    return { size: await sizes.ensure(found.brandId, found.product) };
  });

  app.put('/api/brands/:id/products/:productId/size', async (req, reply) => {
    const found = await find(req.params);
    if (!found) return reply.status(404).send({ error: 'product not found' });
    const words = String((req.body as { size?: unknown } | null)?.size ?? '');
    const size = sizes.set(found.brandId, found.product, words);
    if (size === 'unreadable')
      return reply.status(400).send({ error: 'Give the size with a unit, like 2 cm across or 30 x 20 cm.' });
    return { size: size ?? (await sizes.ensure(found.brandId, found.product)) };
  });
}
