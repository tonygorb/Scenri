import { shopifyAdapter } from './adapters/shopify.js';
import { woocommerceAdapter } from './adapters/woocommerce.js';
import { webflowAdapter } from './adapters/webflow.js';
import { genericAdapter } from './adapters/generic.js';
import { originOf } from './url.js';
import type { AdapterContext, CatalogAdapter, DetectResult, Platform } from './types.js';

const ADAPTERS: CatalogAdapter[] = [shopifyAdapter, woocommerceAdapter, webflowAdapter, genericAdapter];

export function adapterFor(platform: Platform): CatalogAdapter {
  const a = ADAPTERS.find((x) => x.platform === platform);
  if (!a) return genericAdapter;
  return a;
}

/** Probe platforms in priority order; return the strongest match. */
export async function detectPlatform(ctx: AdapterContext): Promise<DetectResult> {
  const base = { ...ctx, baseUrl: originOf(ctx.baseUrl) };
  const results: DetectResult[] = [];

  for (const adapter of ADAPTERS) {
    if (adapter.platform === 'generic') continue;
    try {
      const r = await adapter.detect(base);
      if (r) results.push(r);
    } catch {
      // probe failures are non-fatal
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  if (results[0] && results[0].confidence >= 0.5) return results[0];

  const generic = await genericAdapter.detect(base);
  return generic ?? { platform: 'generic', confidence: 0.1, baseUrl: base.baseUrl, signals: ['fallback'] };
}

export { ADAPTERS };
