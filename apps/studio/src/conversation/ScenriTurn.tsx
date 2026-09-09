import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { ScenriLockup } from '../layout/ScenriMark.js';
import { type QuestionTone, revealDuration } from './question.js';

/**
 * A line from Scenri: the mark and the word above it, the sentence under.
 *
 * The sentence is whole in the DOM from its first frame; what moves is a
 * mask sweeping across it once, on the one node, for as long as the line is
 * long. A screen reader hears the finished line once. Reduced motion, or any
 * key or click while it plays, and the line simply stands.
 */
export function ScenriTurn({
  text,
  tone,
  reveal,
  eyebrow = true,
}: {
  text: string;
  tone?: QuestionTone;
  /** Play the arrival sweep: only on a turn that is new to this render. */
  reveal?: boolean;
  eyebrow?: boolean;
}) {
  const playing = useRevealOnce(reveal);
  return (
    <div className="sc-convo-turn" data-who="scenri">
      {eyebrow && (
        <span className="sc-convo-who">
          <ScenriLockup className="sc-convo-mark" aria-label="Scenri" />
        </span>
      )}
      <p
        className="sc-convo-say"
        data-tone={tone}
        data-reveal={playing || undefined}
        style={playing ? ({ '--sc-reveal-d': `${revealDuration(text)}ms` } as CSSProperties) : undefined}
      >
        {text}
      </p>
    </div>
  );
}

/** True while the arrival sweep plays; false once it ends or the person acts. */
export function useRevealOnce(reveal: boolean | undefined): boolean {
  const [playing, setPlaying] = useState(!!reveal);
  const armed = useRef(!!reveal);
  useEffect(() => {
    if (!armed.current) return;
    armed.current = false;
    const stop = () => setPlaying(false);
    const t = setTimeout(stop, 700);
    window.addEventListener('keydown', stop, { once: true });
    window.addEventListener('pointerdown', stop, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', stop);
      window.removeEventListener('pointerdown', stop);
    };
  }, []);
  return playing;
}
