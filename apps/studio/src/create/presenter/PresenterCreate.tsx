import { Confirm } from '../../Confirm.js';
import { StudioShell } from './StudioShell.js';
import { type CreationFlowArgs, useCreationFlow } from './useCreationFlow.js';
import { VIEW_NAME, worthKeeping } from './presenterStudioRules.js';

/**
 * Create presenter: the creation flow on the studio surface.
 *
 * The rail is a conversation. Scenri asks one thing, the person answers by
 * tapping or typing, and the picture arrives on the stage. The head's one
 * action is Start over; above the composer sit the filed-under line while
 * the person is ready to save, and a Keep previous offer while a redrawn
 * view still has the one it replaced behind it.
 */
export function PresenterCreate({ onClose, ...args }: CreationFlowArgs & { onClose: () => void }) {
  const f = useCreationFlow(args);
  const d = f.d;
  const headAction = d ? (
    worthKeeping(d) ? (
      <Confirm
        label="Start over"
        tone="quiet"
        title="Start over?"
        body="The views drawn so far are thrown away. Nothing was saved to the library."
        open={f.confirming === 'start-over' || undefined}
        busy={false}
        onOpenChange={(o) => {
          if (!o) f.setConfirming(null);
        }}
        onConfirm={() => void f.startOver()}
      />
    ) : (
      <button type="button" className="sc-btn sc-btn-ghost" onClick={() => void f.startOver()}>
        Start over
      </button>
    )
  ) : null;

  const dock = (
    <>
      {f.keepPrevious && f.slot && (
        <div className="sc-pstudio-offer">
          <span>Redrew the {VIEW_NAME[f.view]}.</span>
          <button type="button" className="sc-btn sc-btn-ghost" onClick={f.keepPrevious}>
            Keep previous
          </button>
        </div>
      )}
    </>
  );

  const overlay = (
    <Confirm
      label="Redraw the face"
      title="Describe them again?"
      body="The face is drawn again from the new description, and the views built on it follow. Nothing already saved changes."
      busy={false}
      open={f.confirming === 'redescribe'}
      onOpenChange={(o) => {
        if (!o) f.setConfirming(null);
      }}
      onConfirm={f.redescribe}
    />
  );

  return <StudioShell surface={{ ...f.surface, headAction, dock, overlay }} onClose={onClose} />;
}
