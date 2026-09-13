import type { ScrapeReport } from '../apiTypes.js';

/**
 * What a website actually gave up, said plainly.
 *
 * Partial is the normal outcome and has to read as success: a logo and no
 * colours is a kit with a logo in it, not a failed import. The scraper already
 * knew all of this and threw it away - BrandSetup never read the warnings it
 * returns - so this is mostly a matter of saying out loud what was found.
 *
 * Nothing here mentions products. A brand does not need a shop, and the screen
 * that said otherwise is the one this replaces.
 */

export interface KitLine {
  key: 'name' | 'logo' | 'colors';
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
