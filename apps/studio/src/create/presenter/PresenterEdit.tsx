import { Confirm } from '../../Confirm.js';
import { StudioShell } from './StudioShell.js';
import { type EditingFlowArgs, useEditingFlow } from './useEditingFlow.js';
import { VIEW_NAME } from './presenterStudioRules.js';

/**
 * Edit presenter: the editing flow on the studio surface.
 *
 * The same stage, strip, transcript and composer as creation, over the
 * presenter's own page. The head holds Discard changes once something
 * changed and, when there is an older revision to go back to, Revert last
 * change; the close is the surface's own. Above the composer
 * sits a Keep previous offer while a redrawn view still has the one it
 * replaced behind it.
 */
export function PresenterEdit({ onClose, ...args }: EditingFlowArgs & { onClose: () => void }) {
  const f = useEditingFlow(args);

  const headAction = (
    <>
      {f.canRevert && (
        <Confirm
          label="Revert last change"
          tone="quiet"
          title="Revert the last saved change?"
          body={`${f.name} goes back to the pictures and the person before the last save. Shots already made keep what they were made with.`}
          busy={f.leaving}
          onConfirm={() => void f.revert()}
        />
      )}
      {f.dirty && (
        <Confirm
          label="Discard changes"
          tone="quiet"
          title="Discard the changes?"
          body="The views redrawn in this session are thrown away. The saved presenter stays as it was."
          busy={f.leaving}
          onConfirm={() => void f.discard()}
        />
      )}
    </>
  );

  const dock = f.keepPrevious ? (
    <div className="sc-pstudio-offer">
      <span>Redrew the {VIEW_NAME[f.view]}.</span>
      <button type="button" className="sc-btn sc-btn-ghost" onClick={f.keepPrevious}>
        Keep previous
      </button>
    </div>
  ) : f.openErr ? (
    <p className="sc-newdlg-err" role="alert">
      {f.openErr}
    </p>
  ) : null;

  return <StudioShell surface={{ ...f.surface, headAction, dock }} onClose={onClose} />;
}
