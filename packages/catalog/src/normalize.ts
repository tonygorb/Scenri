import { upgradeImageUrl } from './url.js';
import type { CatalogImage, CatalogProduct, CatalogVariant } from './types.js';

function cleanText(s: unknown): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function normalizeProduct(p: CatalogProduct): CatalogProduct {
  const title = cleanText(p.title) || 'Untitled product';
  const images = (p.images ?? [])
    .map((img, i): CatalogImage | null => {
      const url = upgradeImageUrl(String(img.url ?? '').trim());
      if (!/^https?:\/\//i.test(url)) return null;
      return {
        url,
        position: img.position ?? i,
        width: img.width ?? null,
        height: img.height ?? null,
        alt: img.alt ? cleanText(img.alt) : null,
      };
    })
    .filter((x): x is CatalogImage => !!x)
    // dedupe by URL
    .filter((img, i, arr) => arr.findIndex((x) => x.url === img.url) === i)
    .sort((a, b) => a.position - b.position)
    .map((img, i) => ({ ...img, position: i }));

  const variants: CatalogVariant[] = (p.variants ?? []).map((v, i) => ({
    externalKey: String(v.externalKey || `${p.externalKey}:v${i}`),
    title: v.title ? cleanText(v.title) : undefined,
    sku: v.sku ? cleanText(v.sku) : null,
    price: num(v.price),
    compareAtPrice: num(v.compareAtPrice),
    currency: v.currency ?? p.currency ?? null,
    available: v.available ?? null,
    options: v.options ?? {},
  }));

  const price = num(p.price) ?? variants.find((v) => v.price != null)?.price ?? null;
  const compareAtPrice =
    num(p.compareAtPrice) ?? variants.find((v) => v.compareAtPrice != null)?.compareAtPrice ?? null;

  return {
    externalKey: String(p.externalKey),
    title,
    descriptionHtml: p.descriptionHtml ?? null,
    url: String(p.url),
    handle: p.handle ? cleanText(p.handle) : null,
    vendor: p.vendor ? cleanText(p.vendor) : null,
    productType: p.productType ? cleanText(p.productType) : null,
    tags: [...new Set((p.tags ?? []).map(cleanText).filter(Boolean))],
    category: p.category ? cleanText(p.category) : null,
    price,
    compareAtPrice,
    currency: p.currency ?? variants[0]?.currency ?? null,
    available: p.available ?? (variants.some((v) => v.available) || null),
    variants,
    images,
    collections: [...new Set((p.collections ?? []).map(cleanText).filter(Boolean))],
    raw: p.raw,
  };
}

export function dedupeProducts(products: CatalogProduct[]): CatalogProduct[] {
  const byKey = new Map<string, CatalogProduct>();
  const byUrl = new Map<string, string>();
  const bySkuVendor = new Map<string, string>();

  const merge = (a: CatalogProduct, b: CatalogProduct): CatalogProduct => {
    const images = [...(a.images ?? [])];
    for (const img of b.images ?? []) {
      if (!images.some((x) => x.url === img.url)) images.push({ ...img, position: images.length });
    }
    const variants = [...(a.variants ?? [])];
    for (const v of b.variants ?? []) {
      if (!variants.some((x) => x.externalKey === v.externalKey || (v.sku && x.sku === v.sku))) {
        variants.push(v);
      }
    }
    return normalizeProduct({
      ...a,
      title: a.title || b.title,
      descriptionHtml: a.descriptionHtml || b.descriptionHtml,
      vendor: a.vendor || b.vendor,
      productType: a.productType || b.productType,
      category: a.category || b.category,
      tags: [...new Set([...(a.tags ?? []), ...(b.tags ?? [])])],
      collections: [...new Set([...(a.collections ?? []), ...(b.collections ?? [])])],
      price: a.price ?? b.price,
      compareAtPrice: a.compareAtPrice ?? b.compareAtPrice,
      currency: a.currency ?? b.currency,
      available: a.available ?? b.available,
      images,
      variants,
      raw: a.raw ?? b.raw,
    });
  };

  for (const raw of products) {
    const p = normalizeProduct(raw);
    if (!p.externalKey || !p.title) continue;

    const urlKey = p.url.replace(/\/$/, '').toLowerCase();
    const skuKey = p.variants?.find((v) => v.sku)?.sku
      ? `${(p.vendor ?? '').toLowerCase()}::${p.variants!.find((v) => v.sku)!.sku!.toLowerCase()}`
      : null;

    const existingKey = byKey.has(p.externalKey)
      ? p.externalKey
      : (byUrl.get(urlKey) ?? (skuKey ? bySkuVendor.get(skuKey) : undefined));

    if (existingKey && byKey.has(existingKey)) {
      const merged = merge(byKey.get(existingKey)!, p);
      byKey.set(existingKey, merged);
      byUrl.set(urlKey, existingKey);
      if (skuKey) bySkuVendor.set(skuKey, existingKey);
    } else {
      byKey.set(p.externalKey, p);
      byUrl.set(urlKey, p.externalKey);
      if (skuKey) bySkuVendor.set(skuKey, p.externalKey);
    }
  }

  return [...byKey.values()];
}
