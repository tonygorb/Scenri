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

/** Join a list the way a person writes one. */
function listOf(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** One sentence for a toast: what landed, and what did not. */
export function kitSummary(report: ScrapeReport): string {
  const found: string[] = [];
  if (report.name.source !== 'hostname') found.push(`the name ${report.name.value}`);
  if (report.logo.status === 'primary') found.push('a logo');
  else if (report.logo.status === 'alternate') found.push('a small mark');
  if (report.colors.count > 0) found.push(`${report.colors.count} colours`);

  const missing: string[] = [];
  if (report.logo.status === 'none') missing.push('logo');
  if (report.colors.count === 0) missing.push('colours');

  if (found.length === 0)
    return 'We could not find a logo or clear brand colours on that page. You can add them by hand.';
  const head = `Found ${listOf(found)}.`;
  return missing.length === 0 ? head : `${head} No ${listOf(missing)} yet.`;
}

/** Whether the kit wants a person before it is finished. */
export function kitNeedsHand(report: ScrapeReport): boolean {
  return report.logo.status !== 'primary' || report.colors.count === 0 || report.name.source === 'hostname';
}
