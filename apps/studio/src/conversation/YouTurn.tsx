import { PencilSimple } from '@phosphor-icons/react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { thumbUrl } from '../api.js';
import { Tip } from '../layout/Tip.js';
import { TurnTime, useLeave } from './ScenriTurn.js';

/**
 * Your answer: a bubble on the right, under the line it answered, and a
 * pencil when it can still be changed. Photographs in
 * an answer show as a row of small frames inside the bubble.
 */
export function YouTurn({
  text,
  photos,
  at,
  now,
  editable,
  editing,
  was,
  arrive,
  leave,
  delay = 0,
  turnId,
  dim,
  onEdit,
  onSave,
  onCancel,
}: {
  /** The turn's key, on the element, for what watches the transcript. */
  turnId?: string;
  text: string;
  photos?: string[];
  /** When the answer was given, for the time over the bubble. */
  at?: number;
  /** The clock the whole transcript reads by, so no two times disagree. */
  now?: number;
  editable?: boolean;
  /** New this render: fade and rise into place. */
  arrive?: boolean;
  /** The answer is going, changed from its pencil: a short fade. */
  leave?: boolean;
  /** How long to wait first: the beat the answered block takes to go. */
  delay?: number;
  /** Another answer is being changed: this one steps back while it is. */
  dim?: boolean;
  /** The answer is being rewritten in place. */
  editing?: boolean;
  /** Said, and then changed: it stays as history, quieter, and cannot be changed again. */
  was?: boolean;
  onEdit?: () => void;
  /** Said again, in the same place: the conversation carries on from here. */
  onSave?: (text: string) => void;
  onCancel?: () => void;
}) {
  // an arrival plays once from its mount, whatever renders after
  const [arriving] = useState(!!arrive);
  const [start] = useState(delay);
  const going = useLeave(leave, arriving ? start : 0, arriving ? 240 : 0);
  return (
    <div
      className="sc-convo-turn"
      data-who="you"
      data-arrive={arriving || undefined}
      data-leave={going}
      data-turn={turnId}
      data-was={was || undefined}
      data-dim={dim || undefined}
      style={arriving ? ({ '--sc-convo-start': `${start}ms` } as CSSProperties) : undefined}
    >
      {/* No name over your own words: which side they are on says whose they
          are, the way it does in every conversation anybody has ever read. One
          label on one answer and none on the rest read as a leftover. Scenri
          keeps its name because a line from the app is not a line from you. */}
      {at ? <TurnTime at={at} now={now} /> : null}
      {editing && onSave && onCancel ? (
        <Rewrite text={text} onSave={onSave} onCancel={onCancel} />
      ) : (
        <div className="sc-convo-bubble">
          {editable && !was && onEdit && (
            <Tip label="Change this answer">
              <button type="button" className="sc-convo-edit" aria-label="Change this answer" onClick={onEdit}>
                <PencilSimple size={13} />
              </button>
            </Tip>
          )}
          <p>{text}</p>
          {photos && photos.length > 0 && (
            <div className="sc-convo-photos">
              {photos.map((h, i) => (
                <img key={h} src={thumbUrl(h, 'micro')} alt={`Yours, ${i + 1} of ${photos.length}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * An answer being said again: the words as they were, in a field where they
 * stand. Enter saves, Escape cancels, and nothing else in the conversation
 * moves until one of the two happens.
 */
function Rewrite({ text, onSave, onCancel }: { text: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(text);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = () => {
    const said = draft.trim();
    if (said) onSave(said);
  };
  return (
    <div className="sc-convo-bubble" data-editing="true">
      <textarea
        ref={field}
        className="sc-convo-rewrite"
        aria-label="Your answer"
        rows={Math.min(6, Math.max(1, draft.split('\n').length))}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="sc-convo-rewrite-do">
        <button type="button" className="sc-btn sc-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="sc-btn sc-btn-primary"
          aria-disabled={!draft.trim() || undefined}
          onClick={save}
        >
          Save
        </button>
      </div>
    </div>
  );
}
