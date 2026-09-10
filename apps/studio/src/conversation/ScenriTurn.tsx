import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { thumbUrl } from '../api.js';
import { ScenriMark } from '../layout/ScenriMark.js';
import { type QuestionTone, REVEAL_LEAD_MS, THINK_MS, revealPlan } from './question.js';

/**
 * A line from Scenri: the mark and the word above it, the sentence under.
 *
 * A new line takes a beat before it arrives: the mark breathes and three dots
 * stand where the words will, the way a reply is waited for. Then each word
 * fades in a beat after the last, for as long as the line is long and never
 * past seven tenths of a second. The sentence is whole in the DOM from its
 * first frame, so a screen reader hears the finished line once. Reduced
 * motion, or any key or click while it plays, and the line simply stands.
 * Lines that arrive together take their turns, one after the other.
 */
export function ScenriTurn({
  text,
  tone,
  at,
  reveal,
  eyebrow = true,
  delay = 0,
  leave,
  turnId,
  dim,
  thumb,
  label,
  current,
  restore,
  onRestore,
}: {
  text: string;
  tone?: QuestionTone;
  /** When the line was said, for the time beside the name. */
  at?: number;
  /** A picture the line is about, shown small under it. */
  thumb?: string;
  /** Its name: the view and its number. */
  label?: string;
  /** It is the one on its view right now. */
  current?: boolean;
  /** The picture can be put back as it was; the button says so. */
  restore?: { view: string; hash: string };
  onRestore?: (view: string, hash: string) => void;
  /** The turn's key, on the element, for what watches the transcript. */
  turnId?: string;
  /** Play the arrival: only on a turn that is new to this render. */
  reveal?: boolean;
  eyebrow?: boolean;
  /** The line is going: a short fade. */
  leave?: boolean;
  /** How long after the turn before it this one starts, when several arrive together. */
  delay?: number;
  /** An answer is being changed elsewhere: this line steps back while it is. */
  dim?: boolean;
}) {
  // the timing a turn arrives by is fixed when it mounts, whatever renders after
  const [start] = useState(delay);
  const going = useLeave(leave, start);
  const { playing, thinking } = useRevealOnce(reveal, text, start, going === 'true');
  return (
    <div
      className="sc-convo-turn"
      data-who="scenri"
      data-arrive={playing || undefined}
      data-leave={going}
      data-turn={turnId}
      data-dim={dim || undefined}
      style={
        playing
          ? ({ ...arrivalVars(start), '--sc-convo-after': `${revealPlan(text).total}ms` } as CSSProperties)
          : undefined
      }
    >
      {eyebrow && <Eyebrow thinking={thinking} at={at} />}
      <p className="sc-convo-say" data-tone={tone} data-reveal={playing || undefined}>
        {thinking && <Thinking />}
        <RevealWords text={text} playing={playing} />
      </p>
      {thumb && (
        <span className="sc-convo-shot" data-reveal={playing || undefined} data-current={current || undefined}>
          <img src={thumbUrl(thumb, 'micro')} alt={current && label ? `${label}, active` : (label ?? '')} />
          {restore && onRestore ? (
            <button
              type="button"
              className="sc-convo-shot-do sc-convo-restore"
              onClick={() => onRestore(restore.view, restore.hash)}
            >
              Put back
            </button>
          ) : (
            current && <span className="sc-convo-shot-do">Active</span>
          )}
        </span>
      )}
    </div>
  );
}

/** The timing an arriving turn animates by: when it starts, and how long it thinks first. */
export const arrivalVars = (delay: number): CSSProperties =>
  ({ '--sc-convo-start': `${delay}ms`, '--sc-convo-think': `${THINK_MS}ms` }) as CSSProperties;

/**
 * Who is speaking, in a 32px row: the symbol and the name in the rail's own
 * type, never the lockup artwork, which reads heavier than a line of chat at
 * this size. The mark breathes while a line is on its way.
 */
export function Eyebrow({ thinking, at }: { thinking?: boolean; at?: number }) {
  return (
    <span className="sc-convo-who" data-thinking={thinking || undefined}>
      <ScenriMark className="sc-convo-mark" />
      Scenri
      {at ? <TurnTime at={at} /> : null}
    </span>
  );
}

/**
 * When a turn was said, beside the name or over the bubble. It is there for
 * the asking rather than always: a conversation reads as talk, and a column of
 * clock times reads as a log. It is a real `<time>`, so what it says is
 * available to a screen reader whether or not it is on screen.
 */
export function TurnTime({ at }: { at: number }) {
  const d = new Date(at);
  const short = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <time className="sc-convo-time" dateTime={d.toISOString()}>
      {short}
    </time>
  );
}

/**
 * Scenri, working: the mark and the name where the next line will come from,
 * with three dots after them. It stands only while something is genuinely being
 * waited for, and it is what resolves into the line when it arrives.
 */
export function Working({ what = 'Thinking' }: { what?: string }) {
  return (
    <div className="sc-convo-turn" data-who="scenri" data-working="true">
      <Eyebrow thinking />
      <p className="sc-convo-say" role="status">
        <span className="sc-convo-work">
          {what}
          <Ellipsis />
        </span>
      </p>
    </div>
  );
}

/**
 * The three dots of a word still being said, as three full stops in that
 * word's own type rather than beads beside it. A reader hears "Drawing", once,
 * with no punctuation read out; the eye sees the sentence finish itself.
 */
export function Ellipsis() {
  return (
    <span className="sc-convo-ell" aria-hidden="true">
      <i>.</i>
      <i>.</i>
      <i>.</i>
    </span>
  );
}

/** Three dots where the words will be, for the beat before they arrive. */
export function Thinking() {
  return (
    <span className="sc-convo-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The words of a line, each on its own beat while the line arrives, plain text once it has. */
export function RevealWords({ text, playing }: { text: string; playing: boolean }) {
  if (!playing) return <>{text}</>;
  const { words, step } = revealPlan(text);
  let n = 0;
  let at = 0;
  return (
    <>
      {words.map((w) => {
        const start = at;
        at += w.length;
        if (/^\s+$/.test(w)) return w;
        const beat = n++;
        return (
          <span
            key={`${start}:${w}`}
            className="sc-convo-w"
            style={{ '--sc-convo-word-delay': `${beat * step}ms` } as CSSProperties}
          >
            {w}
          </span>
        );
      })}
    </>
  );
}

/**
 * The arrival: `thinking` for the beat before the words, `playing` until the
 * last word has landed. A line that is going has nothing left to play. What
 * the person does meanwhile does not hurry it: a line takes its beat whether
 * or not the next answer is already being typed, and a queue of lines is
 * bounded by one beat each, so nothing ever snaps in whole.
 */
export function useRevealOnce(
  reveal: boolean | undefined,
  text: string,
  delay = 0,
  leave = false,
): { playing: boolean; thinking: boolean } {
  const [playing, setPlaying] = useState(!!reveal);
  const [thinking, setThinking] = useState(!!reveal);
  // A line can be said twice without leaving in between: a question that was
  // standing, asked again because the answer behind it changed. It plays from
  // the beginning, the way it would if it had arrived for the first time.
  const was = useRef(!!reveal);
  useEffect(() => {
    if (reveal && !was.current) {
      setPlaying(true);
      setThinking(true);
    }
    was.current = !!reveal;
  }, [reveal]);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      setThinking(false);
      setPlaying(false);
    }, delay + revealPlan(text).total);
    const th = setTimeout(() => setThinking(false), delay + THINK_MS);
    return () => {
      clearTimeout(t);
      clearTimeout(th);
    };
  }, [playing, text, delay]);
  return { playing: playing && !leave, thinking: playing && thinking && !leave };
}

/**
 * How a turn leaves: with a fade once it has arrived, and unseen when it is
 * told to go before its arrival began (a line replaced within its wait). An
 * early leave only hides the turn: its arrival keeps running underneath, so
 * a line that is back a frame later arrives when it was going to.
 */
export function useLeave(
  leave: boolean | undefined,
  start: number,
  /** How long after its start the turn counts as seen: a line once its words begin, an answer once it has landed. */
  seenAfter = THINK_MS + REVEAL_LEAD_MS,
): 'early' | 'true' | undefined {
  const mounted = useRef(performance.now());
  if (!leave) return undefined;
  return performance.now() - mounted.current < start + seenAfter ? 'early' : 'true';
}
