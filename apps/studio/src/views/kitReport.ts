import type { CommerceScan, ScrapeReport } from '../apiTypes.js';

/**
 * What a website actually gave up, said plainly.
 *
 * Partial is the normal outcome and has to read as success: a logo and no
 * colours is a kit with a logo in it, not a failed import. The scraper already
 * knew all of this and threw it away - BrandSetup never read the warnings it
 * returns - so this is mostly a matter of saying out loud what was found.
 *
 * The brand lines never mention products: a brand does not need a shop, and
 * the screen that said otherwise is the one this replaced. Products get their
 * own line, from their own scan, and only when a site turned out to have some
 * - see `productLine`.
 */

export interface KitLine {
  key: 'name' | 'logo' | 'colors' | 'products';
  found: boolean;
  label: string;
  value: string;
}

export function kitLines(report: ScrapeReport): KitLine[] {
  const name: KitLine =
    report.name.source === 'hostname'
      ? { key: 'name', found: false, label: 'Name', value: `taken from the address (${report.host})` }
      : { key: 'name', found: true, label: 'Name', value: report.name.value };

  const logo: KitLine =
    report.logo.status === 'primary'
      ? { key: 'logo', found: true, label: 'Logo', value: 'found on the site' }
      : report.logo.status === 'alternate'
        ? { key: 'logo', found: true, label: 'Logo', value: 'only a small mark, saved as an alternate' }
        : { key: 'logo', found: false, label: 'Logo', value: 'none found' };

  const colors: KitLine =
    report.colors.count > 0
      ? { key: 'colors', found: true, label: 'Colours', value: `${report.colors.count} taken from the site` }
      : { key: 'colors', found: false, label: 'Colours', value: 'none we could trust' };

  return [name, logo, colors];
}

/** Whether the kit wants a person before it is finished. */
export function kitNeedsHand(report: ScrapeReport): boolean {
  return report.logo.status !== 'primary' || report.colors.count === 0 || report.name.source === 'hostname';
}

/**
 * The products line, or nothing at all.
 *
 * Nothing at all is the important case. A portfolio has no shop, has never
 * wanted one, and a row reading "0 products" turns a complete brand import
 * into a scoreboard with a zero on it. So a site with no commerce signal says
 * nothing about products, exactly as this screen did before there was a scan.
 *
 * A count from a sitemap is approximate on purpose: a sitemap lists addresses,
 * not products, and some of those addresses are the same item in another
 * market. "About 2,200" is true where "2,200" would be a number we made up.
 */
export function productLine(scan: CommerceScan | null, scanning: boolean): KitLine | null {
  if (scanning) return { key: 'products', found: false, label: 'Products', value: 'looking for a shop' };
  if (!scan || scan.verdict === 'none') return null;
  if (scan.verdict === 'found') {
    const about = scan.countSource === 'sitemap' && scan.count > 20;
    return {
      key: 'products',
      found: true,
      label: 'Products',
      value: `${about ? 'about ' : ''}${scan.count.toLocaleString()} found`,
    };
  }
  // Listed but unreadable, or a storefront we could not list at all. Both are
  // a shop we failed to open, which is not the same as a site without one.
  return { key: 'products', found: false, label: 'Products', value: 'we could not load the catalogue' };
}

/** Whether there is a catalog worth offering to import. */
export function hasCatalog(scan: CommerceScan | null): boolean {
  return !!scan && scan.verdict === 'found' && scan.candidates.length > 0;
}
