// SPDX-License-Identifier: Apache-2.0
/**
 * Fold a fresh scrape back into a brand someone has already edited.
 *
 * A re-scrape is not a re-import. By the time a user asks for one they have
 * usually renamed the brand, fixed the tagline the meta description got wrong,
 * and hand-picked a palette — so the only safe default is that a scrape may
 * fill gaps and may never overwrite a decision. The one exception is the
 * website itself, which is the thing being refreshed.
 *
 * The palette is deliberately not merged even when it differs: colours are the
 * most-edited part of a kit and the least reliable part of a scrape. A brand
 * that already has one gets the scraped hexes back as `suggestions`, which the
 * UI offers as opt-in chips. Nothing lands without a click.
 */

export interface MergeScrapeResult {
  brand: Record<string, unknown>;
  suggestions: {
    /** Scraped colours the caller may offer, empty when the palette was taken wholesale. */
    palette: { hex: string }[];
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const hashOf = (ref: unknown): string => {
  const s = String(ref ?? '');
  return s.startsWith('asset:') ? s.slice(6) : s;
};

/** Every colour a scraped palette carries, in the order it ranked them. */
function scrapedHexes(palette: any): { hex: string }[] {
  return [palette?.primary, palette?.secondary, ...arr(palette?.accent), ...arr(palette?.neutrals)]
    .filter((c: any) => typeof c?.hex === 'string')
    .map((c: any) => ({ hex: String(c.hex) }));
}

const hasPalette = (palette: any): boolean => scrapedHexes(palette).length > 0;

export function mergeScrape(existing: unknown, scraped: unknown): MergeScrapeResult {
  const cur = (existing ?? {}) as Record<string, any>;
  const next = (scraped ?? {}) as Record<string, any>;

  const meta: Record<string, unknown> = { ...(cur.meta ?? {}) };
  // Fill, never overwrite: an empty name is impossible (the schema requires
  // one), but an empty tagline is the normal state of a brand made from scratch.
  if (!str(meta.name) && str(next.meta?.name)) meta.name = str(next.meta.name);
  if (!str(meta.tagline) && str(next.meta?.tagline)) meta.tagline = str(next.meta.tagline);
  if (str(next.meta?.website)) meta.website = str(next.meta.website);
  if (str(next.meta?.updatedAt)) meta.updatedAt = str(next.meta.updatedAt);

  const brand: Record<string, unknown> = { ...cur, meta };

  let suggestions: { hex: string }[] = [];
  if (hasPalette(next.palette)) {
    if (hasPalette(cur.palette)) suggestions = scrapedHexes(next.palette);
    else brand.palette = { ...(cur.palette ?? {}), ...next.palette };
  }

  // Marks accrete. Content addressing makes the duplicate check exact, so
  // re-scraping an unchanged site adds nothing, and a mark the user uploaded
  // by hand is never removed by a scrape that failed to find one.
  const scrapedLogos = arr(next.logos);
  if (scrapedLogos.length) {
    const have = new Set(arr(cur.logos).map((l: any) => hashOf(l?.file)));
    const added = scrapedLogos.filter((l: any) => !have.has(hashOf(l?.file)));
    if (added.length) {
      // A scrape may call its find "primary", but the kit holds one primary at
      // a time and the user's standing choice outranks a crawler's guess: an
      // incoming primary lands as an alternate whenever one already exists,
      // counting earlier additions in this same merge.
      let hasPrimary = arr(cur.logos).some((l: any) => l?.role === 'primary');
      const demoted = added.map((l: any) => {
        if (l?.role !== 'primary') return l;
        if (hasPrimary) return { ...l, role: 'alternate' };
        hasPrimary = true;
        return l;
      });
      brand.logos = [...arr(cur.logos), ...demoted];
    }
  }

  return { brand, suggestions: { palette: suggestions } };
}
