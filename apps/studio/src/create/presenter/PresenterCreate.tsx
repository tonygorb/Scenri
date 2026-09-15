import { useState } from 'react';
import { Confirm } from '../../Confirm.js';
import { StudioShell } from './StudioShell.js';
import { type CreationFlowArgs, useCreationFlow } from './useCreationFlow.js';
import { REDRAW_BODY, REDRAW_BODY_PHOTOS, REDRAW_TITLE } from './presenterCopy.js';
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
  /**
   * Closing with answers and nothing drawn from them yet would throw the
   * answers away, so it is asked about first. Once a draft exists it is the
   * record, offered back on the presenters page, and closing costs nothing.
   */
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    if (f.unsaved) {
      setLeaving(true);
      return;
    }
    onClose();
  };
  /**
   * Start over begins a new conversation and throws nothing away.
   *
   * It used to delete the draft, so a person with a face and a full body drawn
   * pressed it, agreed, and lost the generations. Nothing about starting again
   * requires destroying what is already drawn: the unfinished person stays on
   * the wall and Continue reopens them. It still asks, because restarting the
   * conversation is a surprise worth naming, and because the same dialog is
   * what a door change under a drawn face opens (`editCost`). Discarding is the
   * card's own X, which asks when there is drawn work on it.
   */
  const headAction = f.begun ? (
    d ? (
      <Confirm
        label="Start over"
        tone="quiet"
        title="Start over?"
        body={`This conversation begins again from the first question. ${
          worthKeeping(d)
            ? 'The views drawn so far are kept: the unfinished presenter stays on your wall.'
            : 'The unfinished presenter stays on your wall, with anything added to it.'
        }`}
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

  // A changed answer under a drawn face is asked about once, before the
  // answer opens: what was drawn from the old answer is drawn again.
  const overlay = (
    <Confirm
      label="Change it"
      title={REDRAW_TITLE}
      body={d?.source === 'photos' ? REDRAW_BODY_PHOTOS : REDRAW_BODY}
      busy={false}
      open={f.confirming === 'redraw'}
      onOpenChange={(o) => {
        if (!o) f.setConfirming(null);
      }}
      onConfirm={f.confirmEdit}
    />
  );

  const asked = (
    <>
      {overlay}
      <Confirm
        label="Leave"
        title="Leave without drawing them?"
        body="Nothing has been drawn yet, so the answers are not kept. Starting again starts from the first question."
        busy={false}
        open={leaving}
        onOpenChange={(o) => {
          if (!o) setLeaving(false);
        }}
        onConfirm={() => {
          setLeaving(false);
          f.leave();
          onClose();
        }}
      />
    </>
  );

  return <StudioShell surface={{ ...f.surface, headAction, dock, overlay: asked }} onClose={close} />;
}
