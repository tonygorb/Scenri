import { Plus } from '@phosphor-icons/react';
import { useCreateAsset } from './AssetCreateHost.js';

/**
 * The one global way to add something to this brand, in the actions track of
 * the top bar at every width.
 *
 * It never says "create". The nav's Create is a destination — the workspace
 * where images are made — and this is the opposite kind of verb: putting an
 * ingredient into the library that workspace draws on. Three things keep them
 * apart without a word of explanation: a different track, a different glyph
 * (bare Plus against the nav's PlusCircle) and a label that avoids the word.
 */
export function NewAssetButton() {
  const createAsset = useCreateAsset();
  return (
    <button
      type="button"
      className="sc-icon-btn"
      aria-label="Add to this brand"
      title="Add to this brand"
      onClick={() => createAsset('choose')}
    >
      <Plus size={17} weight="bold" />
    </button>
  );
}
