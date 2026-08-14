import { useState } from 'react';
import { TextArea, TextField } from '@radix-ui/themes';
import { api } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { AssetCreateShell } from './AssetCreateShell.js';
import { RefStrip } from './RefStrip.js';
import { useAssetFields } from './useAssetFields.js';
import type { FlowProps } from './flow.js';

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
export function PresenterForm({ onBack, onStarted, caps, capsNote, pendingState }: FlowProps) {
  const { brand } = useBrand();
  const { presenterCategories } = useAppData();
  const [busy, setBusy] = useState(false);
  const f = useAssetFields(brand.id, 'presenter', { max: MAX_REFS, pendingState });

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

  return (
    <AssetCreateShell
      title="New presenter"
      sub="Photos of one person. Scenri reads their face, hair and build, then keeps them consistent."
      error={f.err}
      footnote={capsNote(
        caps?.canGenerate
          ? `Builds four studio views on ${caps.engineName ?? 'your engine'}${caps.free ? ', free on this machine' : ''}. A few minutes.`
          : 'No engine connected, so your photos become the references as they are.',
      )}
      primaryLabel="Create presenter"
      ready={ready}
      blocked={blocked}
      busy={busy}
      onBack={onBack}
      onPrimary={() => void start()}
    >
      <div className="sc-assetform">
        <TextField.Root
          placeholder="Their name"
          value={f.fields.name}
          onChange={(e) => f.set({ name: e.target.value })}
        />

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

        <TextArea
          placeholder="Anything worth knowing about them (optional)"
          value={f.fields.instruction}
          onChange={(e) => f.set({ instruction: e.target.value })}
          rows={2}
        />

        {/* Where they file. Optional on purpose: leave it and the analysis picks
            from this same list, so nobody lands untagged and unreachable. */}
        {presenterCategories.length > 0 && (
          <fieldset className="sc-assetform-facets">
            <legend>Casts for</legend>
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
          </fieldset>
        )}
      </div>
    </AssetCreateShell>
  );
}
