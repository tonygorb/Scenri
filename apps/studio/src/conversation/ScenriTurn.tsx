import { type CSSProperties, useEffect, useState } from 'react';
import { ScenriMark } from '../layout/ScenriMark.js';
import { type QuestionTone, THINK_MS, revealPlan } from './question.js';

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
  reveal,
  eyebrow = true,
  delay = 0,
}: {
  text: string;
  tone?: QuestionTone;
  /** Play the arrival: only on a turn that is new to this render. */
  reveal?: boolean;
  eyebrow?: boolean;
  /** How long after the turn before it this one starts, when several arrive together. */
  delay?: number;
}) {
  // the timing a turn arrives by is fixed when it mounts, whatever renders after
  const [start] = useState(delay);
  const playing = useRevealOnce(reveal, text, start);
  return (
    <div
      className="sc-convo-turn"
      data-who="scenri"
      data-arrive={playing || undefined}
      style={playing ? arrivalVars(start) : undefined}
    >
      {eyebrow && <Eyebrow thinking={playing} />}
      <p className="sc-convo-say" data-tone={tone} data-reveal={playing || undefined}>
        {playing && <Thinking />}
        <RevealWords text={text} playing={playing} />
      </p>
    </div>
  );
}

/** The timing an arriving turn animates by: when it starts, and how long it thinks first. */
export const arrivalVars = (delay: number): CSSProperties =>
  ({ '--sc-convo-start': `${delay}ms`, '--sc-convo-think': `${THINK_MS}ms` }) as CSSProperties;

/** The mark and the name, in a 32px row. The mark breathes while a line is on its way. */
export function Eyebrow({ thinking }: { thinking?: boolean }) {
  return (
    <span className="sc-convo-who" data-thinking={thinking || undefined}>
      <ScenriMark className="sc-convo-mark" />
      Scenri
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

/** True while the arrival plays; false once it ends or the person acts. */
export function useRevealOnce(reveal: boolean | undefined, text: string, delay = 0): boolean {
  const [playing, setPlaying] = useState(!!reveal);
  useEffect(() => {
    if (!playing) return;
    // The key or click that brought this line is still on its way up to the
    // window when this runs; only what comes after it ends the arrival.
    const armed = performance.now();
    const stop = (e?: Event) => {
      if (e && e.timeStamp < armed) return;
      setPlaying(false);
    };
    const t = setTimeout(stop, delay + revealPlan(text).total);
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', stop);
      window.removeEventListener('pointerdown', stop);
    };
  }, [playing, text, delay]);
  return playing;
}
