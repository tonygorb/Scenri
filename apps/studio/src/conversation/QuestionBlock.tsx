import { Check, Copy, Paperclip } from '@phosphor-icons/react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Choice, Choices } from '../composer/shotSettings/Choices.js';
import { CardStrip } from './CardStrip.js';
import { LookStrip } from './LookStrip.js';
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
 *
 * A question open again from its answer arrives with that answer lit, and a
 * quiet way to leave it as it was. It knows nothing of what the answer means:
 * the flow hands it `given` and takes back whatever is tapped.
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

const asOne = (given: unknown): string | null => (typeof given === 'string' ? given : null);
const asMany = (given: unknown): string[] => (Array.isArray(given) ? given : []);
const asRows = (given: unknown): Record<string, string> =>
  given && typeof given === 'object' && !Array.isArray(given) ? (given as Record<string, string>) : {};

export function QuestionBlock({
  question,
  reveal,
  busy,
  eyebrow = true,
  delay = 0,
  leave,
  spent,
  turnId,
  dim,
  at,
  now,
  onAnswer,
  onPick,
  onStarter,
  onDescribe,
  onAttachFiles,
  onCancel,
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
  /** An answer is being changed elsewhere: this block steps back while it is. */
  dim?: boolean;
  /** When the question was asked, for the time beside the name. */
  at?: number;
  /** The clock the whole transcript reads by. */
  now?: number;
  onAnswer: (answer: Answer) => void;
  /** A tap was taken: what the block looked like, so the transcript keeps its ghost while the row goes. */
  onPick?: (questionId: string, picked: Picked) => void;
  /** A starter sentence fills the composer; the flow owns the composer's text. */
  onStarter?: (text: string) => void;
  /** Say it in words instead: the composer takes the answer from here. */
  onDescribe?: () => void;
  /** A picture of the thing itself, chosen here: it rides with the answer being written. */
  onAttachFiles?: (files: File[]) => void;
  /** A question open again is left as it was. */
  onCancel?: () => void;
}) {
  // the timing a turn arrives by is fixed when it mounts, whatever renders after
  const [start] = useState(delay);
  const going = useLeave(leave, start);
  const { playing, thinking } = useRevealOnce(reveal, question.prompt, start, going === 'true');
  const given = 'given' in question ? question.given : undefined;
  const [picks, setPicks] = useState<Record<string, string>>(() => asRows(given));
  const [picked, setPicked] = useState<string | null>(null);
  /** What is chosen so far in a question that takes several at once. */
  const [many, setMany] = useState<Set<string>>(() => new Set(asMany(given)));
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
  // the control that stands lit: what was just tapped, else the answer as it was
  const on = picked ?? asOne(given);
  const plan = revealPlan(question.prompt);
  const promptId = `sc-convo-q-${question.id}`;
  const files = useRef<HTMLInputElement>(null);
  const cancel = question.reopened && onCancel && (
    <button type="button" className="sc-btn sc-btn-ghost sc-convo-cancel" onClick={onCancel}>
      Cancel
    </button>
  );
  /**
   * A picture of the thing, chosen from the question itself. It is the same
   * way in as the plus beside the pill and does the same thing: the answer
   * being written takes the picture, and the words go on beside it.
   */
  const attach = 'attach' in question && question.attach && onAttachFiles && (
    <>
      <button type="button" className="sc-chip sc-convo-choice sc-convo-pass" onClick={() => files.current?.click()}>
        <Paperclip size={14} weight="bold" />
        {question.attach}
      </button>
      <input
        ref={files}
        type="file"
        accept="image/*"
        hidden
        aria-label={question.attach}
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
          e.target.value = '';
          if (chosen.length) onAttachFiles(chosen);
        }}
      />
    </>
  );
  return (
    <div
      className="sc-convo-turn"
      data-who="scenri"
      data-arrive={playing || undefined}
      data-leave={going}
      data-turn={turnId}
      data-dim={dim || undefined}
      data-reopened={question.reopened || undefined}
      style={playing ? ({ ...arrivalVars(start), '--sc-convo-after': `${plan.total}ms` } as CSSProperties) : undefined}
    >
      {/* a question open again stands under the line it was asked with: only the way to answer is here */}
      {!question.reopened && eyebrow && <Eyebrow thinking={thinking} at={at} now={now} />}
      {!question.reopened && (
        <p className="sc-convo-say" id={promptId} data-tone={question.tone} data-reveal={playing || undefined}>
          {thinking && <Thinking />}
          <RevealWords text={question.prompt} playing={playing} />
        </p>
      )}
      {question.reopened && (
        <span id={promptId} hidden>
          {question.prompt}
        </span>
      )}
      {!question.reopened && question.hint && (
        <p className="sc-convo-hint" data-reveal={playing || undefined}>
          {question.hint}
        </p>
      )}
      <fieldset
        className="sc-convo-q"
        aria-labelledby={promptId}
        // A question open again takes the keyboard as a group, never as one of
        // its own controls: landing on a control would open that control's
        // tooltip, which is a label nobody asked for over the answer they are
        // changing. From the group, Tab reaches the first choice.
        tabIndex={question.reopened ? -1 : undefined}
        data-kind={question.kind}
        data-reveal={playing || undefined}
        data-picked={!!picked || undefined}
        disabled={busy || undefined}
      >
        {question.starters && question.starters.length > 0 && (
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

        {/* a question answered by looking: the cards are the options */}
        {question.kind === 'choice' && question.options?.some((o) => o.card) && (
          <CardStrip options={question.options} picked={on} onPick={(id) => commit(id, { kind: 'choice', id })} />
        )}

        {question.kind === 'choice' &&
          question.options &&
          !question.groups &&
          !question.options.some((o) => o.card) && (
            <div className="sc-convo-choices">
              {question.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="sc-chip sc-convo-choice"
                  // several at once are chosen, not answered: the tap toggles and
                  // the submit below is what answers, or a second choice would be
                  // impossible to make
                  aria-pressed={question.multi ? many.has(o.id) : undefined}
                  data-on={(question.multi ? many.has(o.id) : on === o.id) || undefined}
                  onClick={() =>
                    question.multi
                      ? setMany((m) => {
                          const next = new Set(m);
                          if (!next.delete(o.id)) next.add(o.id);
                          return next;
                        })
                      : commit(o.id, { kind: 'choice', id: o.id })
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

        {question.kind === 'choice' && (question.describe || question.attach) && (
          <div className="sc-convo-ways">
            {question.describe && onDescribe && (
              <button
                type="button"
                className="sc-chip sc-convo-choice sc-convo-pass"
                aria-pressed={question.saying === undefined ? undefined : question.saying}
                data-on={question.saying || undefined}
                onClick={onDescribe}
              >
                {question.describe}
              </button>
            )}
            {attach}
            {!question.multi && cancel}
          </div>
        )}

        {question.kind === 'choice' &&
          !question.groups &&
          !question.multi &&
          !question.describe &&
          !question.attach &&
          cancel && <div className="sc-convo-ways">{cancel}</div>}

        {question.kind === 'choice' && question.multi && (
          <div className="sc-convo-decide">
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              data-on={picked === 'submit' || undefined}
              onClick={() =>
                commit('submit', { kind: 'choices', picks: Object.fromEntries([...many].map((id) => [id, 'on'])) })
              }
            >
              {question.submit ?? 'Continue'}
            </button>
            {question.skip && (
              <button
                type="button"
                className="sc-btn sc-btn-ghost"
                data-on={picked === 'skip' || (!picked && question.skipped) || undefined}
                onClick={() => commit('skip', { kind: 'skip' })}
              >
                {question.skip}
              </button>
            )}
            {cancel}
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
                  data-on={picked === 'skip' || (!picked && question.skipped) || undefined}
                  onClick={() => commit('skip', { kind: 'skip' })}
                >
                  {question.skip}
                </button>
              )}
              {cancel}
            </div>
          </div>
        )}

        {question.kind === 'swatches' && (
          <div className="sc-convo-look">
            {question.row.options.some((o) => o.art) ? (
              <LookStrip
                options={question.row.options}
                cast={question.cast}
                on={on}
                onPick={(id) => commit(id, { kind: 'swatches', picks: { [question.row.id]: id } })}
              />
            ) : (
              <div className="sc-convo-swatches">
                {question.row.options.map((o) => (
                  <Tip key={o.id} label={o.label}>
                    <button
                      type="button"
                      className={o.color ? 'sc-convo-swatch' : 'sc-chip sc-convo-choice'}
                      style={o.color ? ({ '--sc-swatch': o.color } as CSSProperties) : undefined}
                      aria-label={o.label}
                      data-on={on === o.id || undefined}
                      onClick={() => commit(o.id, { kind: 'swatches', picks: { [question.row.id]: o.id } })}
                    >
                      {o.color ? null : o.label}
                    </button>
                  </Tip>
                ))}
              </div>
            )}
            {(question.skip || question.describe || cancel) && (
              <div className="sc-convo-ways">
                {question.skip && (
                  <button
                    type="button"
                    className="sc-chip sc-convo-choice sc-convo-pass"
                    data-on={picked === 'skip' || (!picked && question.skipped) || undefined}
                    onClick={() => commit('skip', { kind: 'skip' })}
                  >
                    {question.skip}
                  </button>
                )}
                {question.describe && onDescribe && (
                  <button
                    type="button"
                    className="sc-chip sc-convo-choice sc-convo-pass"
                    // pressed, the answer moved to the composer: the way in says
                    // so, and pressing it again hands the step back to its taps
                    aria-pressed={question.saying === undefined ? undefined : question.saying}
                    data-on={question.saying || undefined}
                    onClick={onDescribe}
                  >
                    {question.describe}
                  </button>
                )}
                {cancel}
              </div>
            )}
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

        {question.kind === 'confirm' && question.quote && <Quote text={question.quote} />}

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
            {/* saying something instead of deciding is a way in, not a decision:
                it lights while it is open and closes when it is pressed again */}
            {question.describe && onDescribe && (
              <button
                type="button"
                className="sc-btn sc-btn-ghost"
                aria-pressed={question.saying === undefined ? undefined : question.saying}
                data-on={question.saying || undefined}
                onClick={onDescribe}
              >
                {question.describe}
              </button>
            )}
            {attach}
            {cancel}
          </div>
        )}
        {question.note && (
          // Words this answer already carries beside its choice. A block that
          // lights a chip and shows nothing else is lying about an answer that
          // had words with it, and the hint line cannot say it: that one
          // belongs to the question and is hidden once it is open again.
          <p className="sc-convo-note">{question.note}</p>
        )}
      </fieldset>
    </div>
  );
}

/**
 * Words the question is about, set apart from the talk: the sentence that is
 * going somewhere else, in a block of its own, with a quiet way to take a copy
 * of it. The copy button is there on hover and whenever the keyboard reaches
 * it, so it is never a thing only a mouse can find.
 */
function Quote({ text, label = 'The brief' }: { text: string; label?: string }) {
  const [took, setTook] = useState(false);
  useEffect(() => {
    if (!took) return;
    const t = setTimeout(() => setTook(false), 1600);
    return () => clearTimeout(t);
  }, [took]);
  return (
    <figure className="sc-convo-brief">
      <figcaption className="sc-convo-brief-head">
        <span className="sc-convo-brief-lb">{label}</span>
        <button
          type="button"
          className="sc-convo-brief-copy"
          data-took={took || undefined}
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(
              () => setTook(true),
              () => undefined,
            );
          }}
        >
          {took ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
          {took ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <p className="sc-convo-brief-text">{text}</p>
    </figure>
  );
}

/** Why the photos block cannot continue yet, or null. */
export function photosBlocked(q: Extract<Question, { kind: 'photos' }>): string | null {
  if (q.busy) return 'Still uploading.';
  if (q.hashes.length === 0) return 'Add at least one photo.';
  if (q.attest && !q.attest.checked) return 'Confirm you have permission to use their likeness.';
  return null;
}
