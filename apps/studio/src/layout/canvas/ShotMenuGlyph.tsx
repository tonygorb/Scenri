import type { ShotMenuIcon } from './shotMenu.js';
import { MenuGlyph } from '../menuGlyph.js';

/**
 * The mark beside a shot-menu line. The same drawing every menu in the app
 * uses, so Open and Delete match the catalog cards.
 */
export function ShotMenuGlyph({ name }: { name: ShotMenuIcon }) {
  return <MenuGlyph name={name} />;
}
