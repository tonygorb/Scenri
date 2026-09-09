import { type CSSProperties, useEffect, useState } from 'react';
import { ScenriMark } from '../layout/ScenriMark.js';
import { type QuestionTone, revealPlan } from './question.js';

/**
 * A line from Scenri: the mark and the word above it, the sentence under.
 *
 * The sentence is whole in the DOM from its first frame; what moves is each
 * word fading in a beat after the last, the way a reply is read as it
 * arrives, for as long as the line is long and never past seven tenths of a
 * second. A screen reader hears the finished line once. Reduced motion, or
 * any key or click while it plays, and the line simply stands.
 */
export function ScenriTurn({
  text,
  tone,
  reveal,
  eyebrow = true,
}: {
  text: string;
  tone?: QuestionTone;
  /** Play the arrival: only on a turn that is new to this render. */
  reveal?: boolean;
  eyebrow?: boolean;
}) {
  const playing = useRevealOnce(reveal, text);
  return (
    <div className="sc-convo-turn" data-who="scenri" data-arrive={playing || undefined}>
      {eyebrow && <Eyebrow />}
      <p className="sc-convo-say" data-tone={tone} data-reveal={playing || undefined}>
        <RevealWords text={text} playing={playing} />
      </p>
    </div>
  );
}

/** The mark and the name, in a 32px row. */
export function Eyebrow() {
  return (
    <span className="sc-convo-who">
      <ScenriMark className="sc-convo-mark" />
      Scenri
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
export function useRevealOnce(reveal: boolean | undefined, text: string): boolean {
  const [playing, setPlaying] = useState(!!reveal);
  useEffect(() => {
    if (!playing) return;
    const stop = () => setPlaying(false);
    const t = setTimeout(stop, revealPlan(text).total);
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', stop);
      window.removeEventListener('pointerdown', stop);
    };
  }, [playing, text]);
  return playing;
}
