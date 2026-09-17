import { useCallback, useState, type KeyboardEvent } from 'react';
import { api } from '../api.js';
import { customScenesOf } from '../brandAssets.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { AssetCreateShell } from './AssetCreateShell.js';
import { RefStrip } from './RefStrip.js';
import { useAssetFields } from './useAssetFields.js';
import { named, type FlowProps } from './flow.js';

const MAX_REFS = 4;

/**
 * Building a place.
 *
 * Words carry an environment; a figure-led scene also sends one picture — its
 * own drawn card, the identity-neutral plate — so a dense treatment survives
 * compilation. The references are read, described, and kept as evidence;
 * whoever was in them never rides. So either a picture or a sentence will do,
 * and both is better than either.
 */
export function SceneForm({ onBack, onStarted, caps, capsNote, pendingState, restore, onDiscarded }: FlowProps) {
  const { brand } = useBrand();
  const { verticals } = useAppData();
  const [busy, setBusy] = useState(false);
  // What this brand has already built, so a draft whose build the server has
  // forgotten is not mistaken for one that never finished.
  const exists = useCallback((n: string) => named(customScenesOf(brand), n), [brand]);
  const f = useAssetFields(brand.id, 'scene', { max: MAX_REFS, pendingState, exists, restore, onDiscarded });

  const ready = Boolean(f.fields.name.trim()) && (f.fields.imageHashes.length > 0 || !!f.fields.instruction.trim());
  const blocked = ready ? undefined : 'Add a name, and a photo or a line of direction';

  const start = async () => {
    setBusy(true);
    f.setErr(null);
    try {
      const { jobId } = await api.startAssetBuild(brand.id, {
        kind: 'scene',
        name: f.fields.name.trim(),
        instruction: f.fields.instruction.trim() || undefined,
        imageHashes: f.fields.imageHashes,
        facets: f.fields.facets,
      });
      f.submitted(jobId);
      onStarted({ kind: 'scene', jobId, name: f.fields.name.trim() });
    } catch (e: any) {
      f.setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const submitOnEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (ready && !busy) void start();
  };

  const submitOnMetaEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    if (ready && !busy) void start();
  };

  return (
    <AssetCreateShell
      title="New scene"
      error={f.err}
      footnote={capsNote(caps?.canGenerate ? 'One preview. A few minutes.' : 'Saved without a preview.')}
      primaryLabel="Create scene"
      ready={ready}
      blocked={blocked}
      busy={busy}
      onBack={onBack}
      onPrimary={() => void start()}
      onPasteFiles={(files) => void f.addFiles(files)}
    >
      <div className="sc-assetform">
        <RefStrip
          hashes={f.fields.imageHashes}
          max={MAX_REFS}
          label="Add a place"
          hint={`Screenshots, photography, anything showing the world you want. Up to ${MAX_REFS}.`}
          busy={f.uploading}
          onAdd={(files) => void f.addFiles(files)}
          onRemove={f.removeHash}
          onReject={() => f.setErr('Drop an image file.')}
        />

        <div className="sc-assetform-fields">
          <div className="sc-assetform-field">
            <label className="sc-newdlg-seclabel" htmlFor="sc-scene-name">
              Name
            </label>
            <input
              id="sc-scene-name"
              className="sc-in"
              type="text"
              placeholder="Name this place"
              value={f.fields.name}
              onChange={(e) => f.set({ name: e.target.value })}
              onKeyDown={submitOnEnter}
            />
          </div>
          <div className="sc-assetform-field">
            <label className="sc-newdlg-seclabel" htmlFor="sc-scene-direction">
              Direction
            </label>
            <textarea
              id="sc-scene-direction"
              className="sc-in"
              placeholder="What matters in these references, and what to ignore"
              rows={3}
              maxLength={400}
              value={f.fields.instruction}
              onChange={(e) => f.set({ instruction: e.target.value })}
              onKeyDown={submitOnMetaEnter}
            />
          </div>
        </div>

        {verticals.length > 0 && (
          <fieldset className="sc-assetform-facets">
            <legend>Categories</legend>
            <div className="sc-assetform-facets-chips">
              {verticals.map((v) => (
                <button
                  type="button"
                  key={v}
                  className="sc-chip"
                  data-on={f.fields.facets.includes(v) || undefined}
                  aria-pressed={f.fields.facets.includes(v)}
                  onClick={() => f.toggleFacet(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </AssetCreateShell>
  );
}
