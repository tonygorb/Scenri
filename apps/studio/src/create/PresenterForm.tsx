import { useCallback, useState, type KeyboardEvent } from 'react';
import { api } from '../api.js';
import { customPresentersOf } from '../brandAssets.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { AssetCreateShell } from './AssetCreateShell.js';
import { RefStrip } from './RefStrip.js';
import { useAssetFields } from './useAssetFields.js';
import { named, type FlowProps } from './flow.js';

/** Four is the working ceiling: past that a photo adds nothing an engine reads. */
const MAX_REFS = 4;

/**
 * Casting someone.
 *
 * The whole form is a name and their photographs. Everything structural — the
 * face, the hair, the build, what never to draw them in — is read off those
 * photographs on the server, so nobody here is asked to write a negative prompt
 * or pick a reference weight.
 */
export function PresenterForm({ onBack, onStarted, caps, capsNote, pendingState, restore, onDiscarded }: FlowProps) {
  const { brand } = useBrand();
  const { presenterCategories } = useAppData();
  const [busy, setBusy] = useState(false);
  // See SceneForm: a build the registry has lost is settled by the library.
  const exists = useCallback((n: string) => named(customPresentersOf(brand), n), [brand]);
  const f = useAssetFields(brand.id, 'presenter', { max: MAX_REFS, pendingState, exists, restore, onDiscarded });

  const ready = Boolean(f.fields.name.trim()) && f.fields.imageHashes.length > 0;
  const blocked = ready ? undefined : 'Add a name and at least one photo';

  const start = async () => {
    setBusy(true);
    f.setErr(null);
    try {
      const { jobId } = await api.startAssetBuild(brand.id, {
        kind: 'presenter',
        name: f.fields.name.trim(),
        instruction: f.fields.instruction.trim() || undefined,
        imageHashes: f.fields.imageHashes,
        facets: f.fields.facets,
      });
      f.submitted(jobId);
      onStarted({ kind: 'presenter', jobId, name: f.fields.name.trim() });
    } catch (e: any) {
      f.setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const submitOnEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (ready && !busy) void start();
  };

  return (
    <AssetCreateShell
      title="New presenter"
      error={f.err}
      footnote={capsNote(caps?.canGenerate ? 'Four studio views. A few minutes.' : 'Saved from the photos you add.')}
      primaryLabel="Create presenter"
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
          label="Add photos"
          hint="One works. Two to four, from different angles, hold the likeness far better."
          busy={f.uploading}
          onAdd={(files) => void f.addFiles(files)}
          onRemove={f.removeHash}
          onReject={() => f.setErr('Drop an image file.')}
        />

        <div className="sc-assetform-fields">
          <div className="sc-assetform-field">
            <label className="sc-newdlg-seclabel" htmlFor="sc-presenter-name">
              Name
            </label>
            <input
              id="sc-presenter-name"
              className="sc-in"
              type="text"
              placeholder="Their name"
              value={f.fields.name}
              onChange={(e) => f.set({ name: e.target.value })}
              onKeyDown={submitOnEnter}
            />
          </div>
          <div className="sc-assetform-field">
            <label className="sc-newdlg-seclabel" htmlFor="sc-presenter-notes">
              Notes
            </label>
            <textarea
              id="sc-presenter-notes"
              className="sc-in"
              placeholder="Anything worth knowing about them (optional)"
              rows={2}
              value={f.fields.instruction}
              onChange={(e) => f.set({ instruction: e.target.value })}
            />
          </div>
        </div>

        {presenterCategories.length > 0 && (
          <fieldset className="sc-assetform-facets">
            <legend>Categories</legend>
            <div className="sc-assetform-facets-chips">
              {presenterCategories.map((v) => (
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
