import { type CSSProperties, useState } from 'react';
import { Choice, Choices } from '../composer/shotSettings/Choices.js';
import { RefStrip } from '../create/RefStrip.js';
import { type Answer, type Question, groupsAnswered, revealPlan } from './question.js';
import { Eyebrow, RevealWords, useRevealOnce } from './ScenriTurn.js';

/**
 * A question, native to the transcript: the prompt as Scenri's line, and
 * under it the way to answer. A choice answers on the tap; grouped choices
 * answer together on their button; photographs are a first-class block with
 * their own count, removal and confirmation; a decision is one primary and
 * its quieter alternatives. A sentence has no control here: the composer
 * under the transcript is the answer, and the starters only fill it.
 */
export function QuestionBlock({
  question,
  reveal,
  busy,
  eyebrow = true,
  onAnswer,
  onStarter,
}: {
  question: Question;
  reveal?: boolean;
  /** Off when the line before it was Scenri's already. */
  eyebrow?: boolean;
  /** The flow is mid-request: nothing here answers twice. */
  busy?: boolean;
  onAnswer: (answer: Answer) => void;
  /** A starter sentence fills the composer; the flow owns the composer's text. */
  onStarter?: (text: string) => void;
}) {
  const playing = useRevealOnce(reveal, question.prompt);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const plan = revealPlan(question.prompt);
  const promptId = `sc-convo-q-${question.id}`;
  return (
    <div className="sc-convo-turn" data-who="scenri" data-arrive={playing || undefined}>
      {eyebrow && <Eyebrow />}
      <p className="sc-convo-say" id={promptId} data-tone={question.tone} data-reveal={playing || undefined}>
        <RevealWords text={question.prompt} playing={playing} />
      </p>
      {question.hint && <p className="sc-convo-hint">{question.hint}</p>}
      <fieldset
        className="sc-convo-q"
        aria-labelledby={promptId}
        data-kind={question.kind}
        data-reveal={playing || undefined}
        style={playing ? ({ '--sc-convo-after': `${plan.total}ms` } as CSSProperties) : undefined}
        disabled={busy || undefined}
      >
        {question.kind === 'text' && question.starters && question.starters.length > 0 && (
          <div className="sc-convo-starters">
            {question.starters.map((s) => (
              <button key={s} type="button" className="sc-convo-starter" onClick={() => onStarter?.(s)}>
                {s}
              </button>
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
                onClick={() => onAnswer({ kind: 'choice', id: o.id })}
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
                onClick={() => {
                  if (groupsAnswered(question.groups ?? [], picks)) onAnswer({ kind: 'choices', picks });
                }}
              >
                {question.submit ?? 'Continue'}
              </button>
              {question.skip && (
                <button type="button" className="sc-btn sc-btn-ghost" onClick={() => onAnswer({ kind: 'skip' })}>
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
                onClick={() => {
                  if (!photosBlocked(question)) onAnswer({ kind: 'photos', action: { type: 'submit' } });
                }}
              >
                {question.submit}
              </button>
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
                onClick={() => onAnswer({ kind: 'confirm', id: o.id })}
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
