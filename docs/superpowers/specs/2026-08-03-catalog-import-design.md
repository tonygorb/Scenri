# Catalog Import — Design Spec

**Date:** 2026-08-03  
**Status:** Approved for implementation  
**Scope:** Multi-platform HTTP catalog ingestion into Scenri’s product library

## Problem

Today `buildFromUrl` scrapes brand identity only (name, tagline, palette, logo). Products are manual uploads into a minimal `products[]` shape. There is no platform detection, pagination, variants, import jobs, or progress UI. URL-driven product onboarding is table stakes in this category; scenri should go further and import a **complete** public catalog in one pass.

## Goals

- Paste a brand/store/domain URL → detect platform → discover full catalog → import all discoverable products and usable images into the product library
- Shopify, WooCommerce, Webflow Ecommerce, and generic HTTP sources in v1
- Idempotent re-import (update + discover new; no duplicates)
- Clear progress states and partial-failure reporting
- Works for hundreds/thousands of products without bloating portable `.brand`

## Non-goals (v1)

- Playwright / JS browser rendering
- Authenticated stores / Admin API keys
- Shopify channel export / publishing
- Trained product ML models (locked reference images only)

## Product decisions

1. **Multi-platform HTTP adapters** from day one
2. **Unified Products library UX**; catalog rows live in SQLite, not inside `brand.json`
3. Auto-start import in brand setup when a website URL was used; re-sync from brand/products later
4. **Progress dialog** as primary UX; Continue allowed once the catalog is usable while remaining assets may still finish
5. No browser fallback in v1 — JS-only stores report a clear partial/failed reason

## Architecture

```
Studio → POST /api/brands/:id/catalog/import
       → CLI job runner
       → @scenri/catalog (detect → adapter → normalize → dedupe)
       → core SQLite + imageStore
       → GET /api/brands/:id/products (unified manual + catalog)
```

### Package responsibilities

| Package | Role |
|---|---|
| `@scenri/catalog` | Pure ingestion: URL normalize, detect, adapters, normalize, dedupe, pipeline stages. Injectable `fetch`. |
| `@scenri/core` | Persistence: sources, products, variants, images, collections, import jobs |
| `scenri` CLI server | Job runner, HTTP APIs, asset download into `imageStore` |
| Studio | Progress dialog, product grid streaming, re-sync |

### Pipeline stages

1. Normalize URL (redirects, strip tracking, canonical host)
2. Detect platform via ordered probes
3. Discover complete product ID/URL set (paginate until exhausted)
4. Fetch product payloads (bounded concurrency + retries)
5. Normalize to internal `CatalogProduct`
6. Dedupe (platform ID → canonical URL → SKU+vendor)
7. Persist upsert on `(sourceId, externalKey)`
8. Download images at highest practical quality into `imageStore`
9. Finalize: `completed` | `partial` | `failed` with structured errors

### Adapters

| Platform | Sources |
|---|---|
| Shopify | `/products.json` (paged), product sitemaps |
| WooCommerce | Public Store API / wc-api when available, product sitemap, JSON-LD |
| Webflow | Sitemap + JSON-LD + listing HTML |
| Generic | robots/sitemap, RSS/Atom/Google product feed, JSON-LD `Product`, HTML pagination |

Strongest adapter wins; weaker sources may augment completeness.

## Data model

- `catalog_sources` — brandId, url, platform, status, lastImportAt
- `catalog_products` — externalKey, title, descriptionHtml, url, vendor, productType, tags, category, price/compareAt/currency, availability, status (`active`|`unavailable`), raw JSON
- `catalog_variants` — options, sku, price, compareAt, availability
- `catalog_images` — sourceUrl, assetRef, width, height, position
- `catalog_collections` + join table for product links
- `import_jobs` — stage, counts, errors JSON, timestamps

Manual kit products remain in `brand.json.products[]`. Unified list API merges both with `origin: 'manual' | 'catalog'`. Catalog product ids are `cat-<uuid>` so composers and brief compilation can resolve them like kit products.

`.brand` export stays lean (identity + manual/locked subset). Full catalog stays in DB.

## Job API

- `POST /api/brands/:id/catalog/import` `{ url }` → `{ jobId }`
- `GET /api/brands/:id/catalog/jobs/:jobId` → stage, counts, errors, platform
- `GET /api/brands/:id/catalog/source` → current source summary
- `GET /api/brands/:id/products` → unified library
- Stages: `queued` → `discovering` → `fetching_products` → `processing_assets` → `completed` | `partial` | `failed`

## UX

- Brand setup step 3: if brand has a website, auto-start catalog import; show progress dialog with live counts; products appear in grid as they land; Continue enabled when usable
- Brand / Assets products panel: “Import from URL” / “Re-sync catalog”
- Manual upload remains
- No silent failures — job report lists what succeeded/failed and why

## Idempotency

- Upsert on `(sourceId, externalKey)`
- Re-run updates metadata/images, adds new products
- Products missing from source are soft-marked `unavailable` (not hard-deleted)

## Reliability

- Polite User-Agent, timeouts, exponential backoff, bounded concurrency
- Job cancellation support
- Structured job events for observability
- Same API shape is hosted-worker ready later

## Testing

- Unit: detectors, adapter pagination, normalize, dedupe, upsert
- Integration: fixture HTTP for each adapter
- Opt-in live smoke: `CATALOG_LIVE=1` against real stores; assert counts vs sitemap/API totals within tolerance for hidden/draft SKUs

## Success criteria

Paste store URL → progress dialog → complete (or honest partial) catalog in product library → `@product` works with imported locked shots → re-import does not duplicate.
