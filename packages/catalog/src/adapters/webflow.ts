import { httpText } from '../http/fetch.js';
import { absolutize, originOf } from '../url.js';
import { attr, loadHtml } from '../html.js';
import { extractSitemapUrls } from './generic.js';
import { fetchProductPages } from './productPage.js';
import type { CatalogAdapter, CatalogProduct, DetectResult, DiscoverResult } from '../types.js';

export const webflowAdapter: CatalogAdapter = {
  platform: 'webflow',

  async detect(ctx): Promise<DetectResult | null> {
    const origin = originOf(ctx.baseUrl);
    const home = await httpText(origin, {
      fetchImpl: ctx.fetchImpl,
      signal: ctx.signal,
      retries: 1,
      accept: 'text/html',
    });
    if (!home.ok) return null;
    const signals: string[] = [];
    if (/webflow|wf-design|w-commerce|data-wf-|webflow\.io/i.test(home.text)) {
      signals.push('webflow-html');
    }
    if (/w-commerce|commerce-add-to-cart|wf-sku/i.test(home.text)) {
      signals.push('webflow-commerce');
    }
    if (!signals.length) return null;
    return {
      platform: 'webflow',
      confidence: signals.includes('webflow-commerce') ? 0.85 : 0.55,
      baseUrl: origin,
      signals,
    };
  },

  async discover(ctx): Promise<DiscoverResult> {
    const origin = originOf(ctx.baseUrl);
    const warnings: string[] = [];
    const productUrls = new Set<string>();

    try {
      const urls = await extractSitemapUrls(ctx, (u) => {
        const path = new URL(u).pathname;
        return /product/i.test(path) || /\/shop\//i.test(path) || /\/store\//i.test(path);
      });
      for (const u of urls) productUrls.add(u);
    } catch {
      warnings.push('Webflow sitemap could not be read');
    }

    const seeds = [`${origin}/shop`, `${origin}/products`, `${origin}/store`, origin];
    for (const seed of seeds) {
      const { ok, text, url } = await httpText(seed, {
        fetchImpl: ctx.fetchImpl,
        signal: ctx.signal,
        accept: 'text/html',
        retries: 1,
      });
      if (!ok) continue;
      const $ = loadHtml(text);
      for (const el of $.querySelectorAll('a[href]')) {
        const href = absolutize(url, attr(el, 'href') ?? '');
        if (!href?.startsWith(origin)) continue;
        if (/product/i.test(href) || el.closest('[data-wf-sku-capabilities], .w-commerce')) {
          productUrls.add(href.split('?')[0]);
        }
      }
    }

    ctx.onProgress?.({ stage: 'discovering', discovered: productUrls.size });
    if (!productUrls.size) warnings.push('No Webflow product URLs discovered');

    return {
      productKeys: [...productUrls],
      productUrls: [...productUrls],
      estimatedTotal: productUrls.size || null,
      // Webflow has no catalogue API to ask: every product is its own page.
      byPage: true,
      warnings,
    };
  },

  async fetchAll(ctx, discovered): Promise<CatalogProduct[]> {
    return fetchProductPages(ctx, discovered.productUrls, {
      onProduct: (fetched) =>
        ctx.onProgress?.({ stage: 'fetching_products', fetched, discovered: discovered.productUrls.length }),
    });
  },
};
