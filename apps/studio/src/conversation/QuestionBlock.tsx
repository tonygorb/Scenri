import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Choice, Choices } from '../composer/shotSettings/Choices.js';
import { RefStrip } from '../create/RefStrip.js';
import { Tip } from '../layout/Tip.js';
import { type Answer, type Question, groupsAnswered, revealPlan } from './question.js';
import { Eyebrow, RevealWords, Thinking, arrivalVars, useLeave, useRevealOnce } from './ScenriTurn.js';

/**
 * A question, native to the transcript: the prompt as Scenri's line, and
 * under it the way to answer. A choice answers on the tap; grouped choices
 * answer together on their button; photographs are a first-class block with
 * their own count, removal and confirmation; a decision is one primary and
 * its quieter alternatives. A sentence has no control here: the composer
 * under the transcript is the answer, and the starters only fill it.
 */
/**
 * The beat a tap is seen for: the chosen control keeps its light, the rest
 * step back, the row goes. The answer itself is taken at once; the transcript
 * keeps a ghost of the block for this long, so nothing typed meanwhile goes
 * to a question that is already answered.
 */
export const PICK_MS = 300;

/** What a block looked like when it was answered, for its ghost. */
export interface Picked {
  picked: string;
  picks: Record<string, string>;
}

export function QuestionBlock({
  question,
  reveal,
  busy,
  eyebrow = true,
  delay = 0,
  leave,
  spent,
  turnId,
  onAnswer,
  onPick,
  onStarter,
}: {
  question: Question;
  /** The turn's key, on the element, for what watches the transcript. */
  turnId?: string;
  reveal?: boolean;
  /** How long after the turn before it this one starts, when several arrive together. */
  delay?: number;
  /** Off when the line before it was Scenri's already. */
  eyebrow?: boolean;
  /** The flow is mid-request: nothing here answers twice. */
  busy?: boolean;
  /** The question is over and the block is going: a short fade, nothing in it pressable. */
  leave?: boolean;
  /** The block was answered and is on its way out; off again once the same question is live again. */
  spent?: boolean;
  onAnswer: (answer: Answer) => void;
  /** A tap was taken: what the block looked like, so the transcript keeps its ghost while the row goes. */
  onPick?: (questionId: string, picked: Picked) => void;
  /** A starter sentence fills the composer; the flow owns the composer's text. */
  onStarter?: (text: string) => void;
}) {
  // the timing a turn arrives by is fixed when it mounts, whatever renders after
  const [start] = useState(delay);
  const going = useLeave(leave, start);
  const { playing, thinking } = useRevealOnce(reveal, question.prompt, start, going === 'true');
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  // A block that went and is back as the same question (Try again, a retry)
  // is live again. One whose answer is still in flight stays as it was.
  const wasSpent = useRef(false);
  useEffect(() => {
    if (wasSpent.current && !spent) setPicked(null);
    wasSpent.current = !!spent;
  }, [spent]);
  // The answer is taken the moment it is tapped. The block lights the chosen
  // control and hands its look to the transcript, which keeps a ghost of it
  // while the row goes.
  const commit = (id: string, answer: Answer) => {
    if (picked) return;
    setPicked(id);
    onPick?.(question.id, { picked: id, picks });
    onAnswer(answer);
  };
  const plan = revealPlan(question.prompt);
  const promptId = `sc-convo-q-${question.id}`;
  return (
    <div
      className="sc-convo-turn"
      data-who="scenri"
      data-arrive={playing || undefined}
      data-leave={going}
      data-turn={turnId}
      style={playing ? ({ ...arrivalVars(start), '--sc-convo-after': `${plan.total}ms` } as CSSProperties) : undefined}
    >
      {eyebrow && <Eyebrow thinking={thinking} />}
      <p className="sc-convo-say" id={promptId} data-tone={question.tone} data-reveal={playing || undefined}>
        {thinking && <Thinking />}
        <RevealWords text={question.prompt} playing={playing} />
      </p>
      {question.hint && (
        <p className="sc-convo-hint" data-reveal={playing || undefined}>
          {question.hint}
        </p>
      )}
      <fieldset
        className="sc-convo-q"
        aria-labelledby={promptId}
        data-kind={question.kind}
        data-reveal={playing || undefined}
        data-picked={!!picked || undefined}
        disabled={busy || undefined}
      >
        {question.kind === 'text' && question.starters && question.starters.length > 0 && (
          <div className="sc-convo-starters">
            {question.starters.map((s) => (
              <Tip key={s.text} label={s.text}>
                <button type="button" className="sc-convo-starter" onClick={() => onStarter?.(s.text)}>
                  {s.label}
                </button>
              </Tip>
            ))}
          </div>
        )}

        {question.kind === 'choice' && question.options && !question.groups && (
          <div className="sc-convo-choices">
            {question.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="sc-chip sc-convo-choice"
                data-on={picked === o.id || undefined}
                onClick={() => commit(o.id, { kind: 'choice', id: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}

        {question.kind === 'choice' && question.groups && (
          <div className="sc-convo-groups">
            {question.groups.map((g) => (
              <div key={g.id} className="sc-convo-group">
                <span className="sc-convo-group-lb" id={`sc-convo-g-${question.id}-${g.id}`}>
                  {g.label}
                </span>
                <Choices
                  label={g.label}
                  value={picks[g.id] ?? ''}
                  ids={g.options.map((o) => o.id)}
                  onChange={(id) => setPicks((p) => ({ ...p, [g.id]: id }))}
                  className="sc-convo-choices"
                >
                  {g.options.map((o) => (
                    <Choice
                      key={o.id}
                      id={o.id}
                      on={picks[g.id] === o.id}
                      label={o.label}
                      className="sc-chip sc-convo-choice"
                      onPick={() => setPicks((p) => ({ ...p, [g.id]: o.id }))}
                    >
                      {o.label}
                    </Choice>
                  ))}
                </Choices>
              </div>
            ))}
            <div className="sc-convo-decide">
              <button
                type="button"
                className="sc-btn sc-btn-primary"
                aria-disabled={!groupsAnswered(question.groups, picks) || undefined}
                title={groupsAnswered(question.groups, picks) ? undefined : 'Pick one in each row, or skip.'}
                data-on={picked === 'submit' || undefined}
                onClick={() => {
                  if (groupsAnswered(question.groups ?? [], picks)) commit('submit', { kind: 'choices', picks });
                }}
              >
                {question.submit ?? 'Continue'}
              </button>
              {question.skip && (
                <button
                  type="button"
                  className="sc-btn sc-btn-ghost"
                  data-on={picked === 'skip' || undefined}
                  onClick={() => commit('skip', { kind: 'skip' })}
                >
                  {question.skip}
                </button>
              )}
            </div>
          </div>
        )}

        {question.kind === 'photos' && (
          <div className="sc-convo-photos-q">
            <RefStrip
              hashes={question.hashes}
              max={question.max}
              label="Add a photo of their face"
              hint="Drop it here, or choose a file"
              busy={question.busy}
              onAdd={(files) => onAnswer({ kind: 'photos', action: { type: 'add', files } })}
              onRemove={(hash) => onAnswer({ kind: 'photos', action: { type: 'remove', hash } })}
              onReject={() => onAnswer({ kind: 'photos', action: { type: 'reject' } })}
            />
            {question.attest && (
              <label className="sc-convo-attest">
                <input
                  type="checkbox"
                  checked={question.attest.checked}
                  onChange={(e) => onAnswer({ kind: 'photos', action: { type: 'attest', checked: e.target.checked } })}
                />
                <span>{question.attest.text}</span>
              </label>
            )}
            <div className="sc-convo-decide">
              <button
                type="button"
                className="sc-btn sc-btn-primary"
                aria-disabled={!!photosBlocked(question) || undefined}
                title={photosBlocked(question) ?? undefined}
                data-on={picked === 'submit' || undefined}
                onClick={() => {
                  if (!photosBlocked(question)) commit('submit', { kind: 'photos', action: { type: 'submit' } });
                }}
              >
                {question.submit}
              </button>
              {question.back && (
                <button
                  type="button"
                  className="sc-btn sc-btn-ghost"
                  data-on={picked === 'back' || undefined}
                  onClick={() => commit('back', { kind: 'photos', action: { type: 'back' } })}
                >
                  {question.back}
                </button>
              )}
            </div>
          </div>
        )}

        {question.kind === 'confirm' && (
          <div className="sc-convo-decide">
            {question.options.map((o, i) => (
              <button
                key={o.id}
                type="button"
                className={`sc-btn ${i === 0 && !question.quiet ? 'sc-btn-primary' : 'sc-btn-ghost'}`}
                data-on={picked === o.id || undefined}
                onClick={() => commit(o.id, { kind: 'confirm', id: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** Why the photos block cannot continue yet, or null. */
export function photosBlocked(q: Extract<Question, { kind: 'photos' }>): string | null {
  if (q.busy) return 'Still uploading.';
  if (q.hashes.length === 0) return 'Add at least one photo.';
  if (q.attest && !q.attest.checked) return 'Confirm you have permission to use their likeness.';
  return null;
}
