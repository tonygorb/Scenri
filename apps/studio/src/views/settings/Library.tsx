import { api } from '../../api.js';
import { Group } from './Group.js';
import { bytes } from './usageRules.js';

export type LibraryInfo = Awaited<ReturnType<typeof api.home>>;

/**
 * Read by the dialog when it opens rather than here when the page mounts: a
 * fetch on mount painted "…" for a frame and then the folder, two lines tall,
 * pushed the rows under it down as General was chosen.
 */
export function Library({ info, thisComputer }: { info: LibraryInfo | null; thisComputer: boolean }) {
  return (
    <Group>
      <div className="sc-set-row">
        <span className="txt">
          <b>Library folder</b>
          <small>
            {info ? [info.dir, `${bytes(info.bytes)} across ${info.images} images`].filter(Boolean).join(' · ') : '…'}
          </small>
        </span>
        {/* it opens the folder on the computer running Scenri, so only there */}
        {thisComputer && (
          <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void api.reveal()}>
            Reveal
          </button>
        )}
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Export everything</b>
          <small>One zip: brands, cast, prompts, shots. Never keys.</small>
        </span>
        <a className="sc-btn sc-btn-ghost" href="/api/export/all" download>
          Export
        </a>
      </div>
      <div className="sc-set-row">
        <span className="txt">
          <b>Telemetry</b>
          <small>There is none. This row exists to say so.</small>
        </span>
        <span className="sc-tag">off, permanently</span>
      </div>
    </Group>
  );
}
