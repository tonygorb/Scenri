import { useState } from 'react';
import { api } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { AssetCreateShell } from './AssetCreateShell.js';
import { RefStrip } from './RefStrip.js';
import { useAssetFields } from './useAssetFields.js';
import type { FlowProps } from './flow.js';

const MAX_REFS = 4;

/**
 * Building a place.
 *
 * The one flow where words alone are enough, because a scene never contributes
 * pixels to a generation — only prose. Its references are read, described, and
 * then kept as evidence; whatever was staged in them is deliberately dropped.
 * So either a picture or a sentence will do, and both is better than either.
 */
export function SceneForm({ onBack, onStarted, caps, capsNote, pendingState }: FlowProps) {
  const { brand } = useBrand();
  const { verticals } = useAppData();
  const [busy, setBusy] = useState(false);
  const f = useAssetFields(brand.id, 'scene', { max: MAX_REFS, pendingState });

  const ready = Boolean(f.fields.name.trim()) && (f.fields.imageHashes.length > 0 || !!f.fields.instruction.trim());
  const blocked = ready ? undefined : 'Add a name, and either a reference or a description';

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

  return (
    <AssetCreateShell
      title="New scene"
      sub="References of a place. Scenri keeps its light and materials, and drops whatever was staged in them."
      error={f.err}
      footnote={capsNote(
        caps?.canGenerate
          ? `Draws one example on ${caps.engineName ?? 'your engine'}${caps.free ? ', free on this machine' : ''}. A few minutes.`
          : 'No engine connected, so this scene is saved without an example image.',
      )}
      primaryLabel="Create scene"
      ready={ready}
      blocked={blocked}
      busy={busy}
      width="460px"
      onBack={onBack}
      onPrimary={() => void start()}
    >
      <div className="sc-assetform">
        <RefStrip
          hashes={f.fields.imageHashes}
          max={MAX_REFS}
          label="Add references"
          hint={`Screenshots, photography, anything showing the world you want. Up to ${MAX_REFS}.`}
          busy={f.uploading}
          onAdd={(files) => void f.addFiles(files)}
          onRemove={f.removeHash}
          onReject={() => f.setErr('Drop an image file.')}
        />

        <input
          className="sc-newtitle"
          type="text"
          placeholder="Name this place"
          aria-label="Scene name"
          value={f.fields.name}
          onChange={(e) => f.set({ name: e.target.value })}
        />

        {/* The one flow where words alone are enough, so the prose gets room
            rather than a two-line box at the bottom of a stack. */}
        <textarea
          className="sc-newnote"
          placeholder="What matters here, in your words. Keep the architecture and the light, lose the plants."
          aria-label="What matters here"
          rows={3}
          value={f.fields.instruction}
          onChange={(e) => f.set({ instruction: e.target.value })}
        />

        {verticals.length > 0 && (
          <fieldset className="sc-assetform-facets">
            <legend>Suits</legend>
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
          </fieldset>
        )}
      </div>
    </AssetCreateShell>
  );
}
