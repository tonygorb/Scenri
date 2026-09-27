import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { startJob, stopJob } from './frameLoop.js';
import { develop, swirlField } from './swirl.js';
import { tonesOf } from './tones.js';

/**
 * A picture just made, landing where it was waited for. Until the picture has
 * decoded (`ready`) this canvas keeps drawing the swirl exactly where the
 * waiting box left it, so the box never blinks empty between the two; once it
 * has, the same canvas plays the landing (swirl.ts, develop), its first frame
 * before paint. The landing's last frame is the photograph, clear, so the
 * canvas simply goes.
 */
export function Arrival({
  img,
  ready,
  index = 0,
  since,
  onDone,
}: {
  img: RefObject<HTMLImageElement | null>;
  ready: boolean;
  /** The tile's slot in its batch, so it lands from the swirl it waited in. */
  index?: number;
  /** When this landing began (performance ms), if it already had: a tile re-laid out mid-landing carries on from there. */
  since?: number;
  onDone: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);
  // waiting: the swirl, on this canvas, until the picture can be shown
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || ready) return;
    const field = swirlField(canvas, tonesOf(canvas), index, null);
    const r = canvas.getBoundingClientRect();
    field.size(r.width, r.height);
    field.draw(performance.now() / 1000);
    const draw = (t: number) => field.draw(t);
    startJob(draw);
    return () => stopJob(draw);
  }, [ready]);
  // landing: from now, frame by frame
  useLayoutEffect(() => {
    const canvas = ref.current;
    const picture = img.current;
    if (!canvas || !picture || !ready) return;
    const r = canvas.getBoundingClientRect();
    const started = performance.now();
    const t0 = since ?? started;
    const drawer = develop(canvas, picture, tonesOf(canvas), index, r.width, r.height, t0 / 1000);
    // Time moves on only while the page is being drawn. A background tab, or a
    // window covered by another, gets no frames at all: timed by the clock, a
    // landing that began unseen was already over by the first frame anyone
    // saw, and the picture simply appeared. Each drawn frame advances it by at
    // most 50ms, so it plays when it is seen, whenever that is.
    let elapsed = Math.min(drawer.ms, started - t0);
    drawer.draw(elapsed / drawer.ms);
    let last = started;
    let raf = requestAnimationFrame(function tick(now) {
      elapsed += Math.min(50, Math.max(0, now - last));
      last = now;
      const p = Math.min(1, elapsed / drawer.ms);
      drawer.draw(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDone(true);
    });
    return () => cancelAnimationFrame(raf);
    // once, when the picture is ready: where it began is read then, never again
  }, [ready]);
  useEffect(() => {
    if (done) onDone();
  }, [done, onDone]);
  return <canvas ref={ref} className="sc-arrival" aria-hidden />;
}
