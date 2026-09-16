import type { CommerceScan, ScrapeReport } from '../apiTypes.js';
import type { ScanOutcome } from './brandSetup/useCommerceScan.js';

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

const line = (value: string, found = false): KitLine => ({ key: 'products', found, label: 'Products', value });

/**
 * The products line, or nothing at all.
 *
 * Nothing at all is the important case, and it is narrower than it looks. A
 * portfolio has no shop, has never wanted one, and a row reading "0 products"
 * turns a complete brand import into a scoreboard with a zero on it. So a site
 * with no commerce signal says nothing about products, exactly as this screen
 * did before there was a scan.
 *
 * Only that case. This used to read `if (!scan || scan.verdict === 'none')`,
 * and the first half of that swallowed every way a scan can fail: a timeout, a
 * server error, an unread poll. All four drew as the portfolio, so the row
 * vanished and the screen offered "Looks right" over a store with 1,186
 * readable products in it. A failure is not an absence, and it gets said.
 *
 * A count from a sitemap is approximate on purpose: a sitemap lists addresses,
 * not products, and some of those addresses are the same item in another
 * market. "About 2,200" is true where "2,200" would be a number we made up.
 */
export function productLine(outcome: ScanOutcome): KitLine | null {
  switch (outcome.kind) {
    case 'idle':
      return null;
    case 'scanning':
      return line('looking for a shop');
    case 'timeout':
      return line('this site took too long to search');
    case 'error':
      return line('the search did not finish');
    case 'result': {
      const { scan } = outcome;
      // The one silence, and the only one.
      if (scan.verdict === 'none') return null;
      if (scan.verdict === 'found') {
        const about = scan.countSource === 'sitemap' && scan.count > 20;
        return line(`${about ? 'about ' : ''}${scan.count.toLocaleString()} found`, true);
      }
      // Listed but unreadable, or a storefront we could not list at all. Both
      // are a shop we failed to open, which is not a site without one.
      return line('we could not load the catalogue');
    }
  }
}

/**
 * Whether the look ended in a way the person should be offered another go at.
 *
 * A site with no shop is finished business. Everything else that did not
 * produce a catalogue is worth one more press, and used to offer none.
 */
export function scanRetryable(outcome: ScanOutcome): boolean {
  if (outcome.kind === 'timeout' || outcome.kind === 'error') return true;
  return outcome.kind === 'result' && (outcome.scan.verdict === 'blocked' || outcome.scan.verdict === 'likely');
}

/** Whether there is a catalog worth offering to import. */
export function hasCatalog(scan: CommerceScan | null): boolean {
  if (!scan || scan.verdict !== 'found') return false;
  // Either way of knowing what is in the shop counts. `candidates` are read
  // from product pages, one request each, and a store with a bulk listing has
  // none of them - it hands its whole catalogue over at once as `cards`
  // instead. Checking only the first is what sent a person who had just been
  // shown 1,187 products to the home page with nothing imported: the row said
  // "1,187 found" and the button underneath it quietly read "Looks right".
  return scan.candidates.length > 0 || (scan.cards?.length ?? 0) > 0;
}
