import { useLayoutEffect, useRef, useState } from 'react';
import { parseTime } from '../tasks.js';
import { startJob, stopJob } from './rendering/frameLoop.js';
import { type Drawer, fromPicture, swirlField } from './rendering/swirl.js';
import { onThemeChange, prefersStill, tonesOf } from './rendering/tones.js';

/** How long after Generate a job's swirl may still be forming. */
const FORMING_S = 4;
/**
 * The last send's first moment, on both clocks: the stand-ins that answer
 * Generate start their swirl at it, and the running tiles that replace them a
 * moment later (their record created when the send reached the server)
 * adopt it, so the swirl forms once, continuously, across the swap.
 */
let lastSend: { perf: number; epoch: number } | null = null;

/** When this box's swirl began (performance seconds), if it is still forming; null once it is simply running. */
function bornOf(appear: boolean | undefined, since: string | undefined): number | null {
  const now = performance.now() / 1000;
  const recent = lastSend && Date.now() - lastSend.epoch < 2500 ? lastSend : null;
  if (appear) {
    if (!recent) lastSend = { perf: now, epoch: Date.now() };
    return (recent ?? lastSend)?.perf ?? now;
  }
  if (!since) return null;
  const created = parseTime(since);
  if (Number.isNaN(created)) return null;
  const age = (Date.now() - created) / 1000;
  if (age > FORMING_S) return null;
  if (lastSend && Math.abs(created - lastSend.epoch) < 2500) return lastSend.perf;
  return now - Math.max(0, age);
}

/**
 * When each start from a picture began, by the moment it was asked for. Its
 * clock starts on the frame the picture is first shown under it, not at the
 * press: the stage takes a moment to move to the new step, and a start
 * already under way by then would open with a jump. A remount carries on.
 */
const startedFrom = new Map<number, number>();

/**
 * A picture being made: the swirl (rendering/swirl.ts), in the box the picture
 * will take, on its host's own ground. `index` is the box's slot in its
 * batch. `appear` marks the stand-in that first answers Generate and `since`
 * a running box's record time: together they say whether the swirl is still
 * forming, and from when. `from` is a picture on screen the job was asked
 * from (a refinement, on the stage showing its source), and when: the swirl
 * is then made from it, and carries on from there.
 *
 * Every canvas draws in one loop at the display's rate; one off screen is
 * skipped; under reduced motion one frame is drawn and held. The first frame
 * is drawn before paint, and the swirl is a function of the clock and the
 * slot alone, so a box that remounts (a stand-in becoming its running tile, a
 * column dealt again) carries on exactly where it was.
 */
export function Rendering({
  index = 0,
  appear,
  since,
  from,
}: {
  index?: number;
  appear?: boolean;
  since?: string;
  from?: { src: string; at: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pictureRef = useRef<HTMLImageElement>(null);
  const [born] = useState(() => bornOf(appear, since));
  // the picture it starts from is the one it was first given: the stage
  // re-renders every second, and stops knowing it a moment later
  const [origin] = useState(from);
  // that picture, under the start, until the swirl has taken over from it
  const [under, setUnder] = useState(() => !!origin && !prefersStill());
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas?.getContext('2d')) return;
    const still = prefersStill();
    const picture = pictureRef.current;
    // only from a picture already there to be seen: the stage just showed it, so it is decoded
    const start = origin && picture?.complete && picture.naturalWidth ? origin : null;
    const formsFrom = still || start ? null : born;
    let field = swirlField(canvas, tonesOf(canvas), index, formsFrom);
    let visible = true;
    const sizeAndDraw = () => {
      const r = canvas.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      field.size(r.width, r.height);
      field.draw(performance.now() / 1000);
    };
    let drawer: Drawer | null = null;
    let elapsed = 0;
    let last = 0;
    // The swirl's first frame and the picture's leaving are the same frame:
    // the swirl's gaps are clear, and the picture must not show through them.
    const handOff = () => {
      drawer = null;
      if (picture) picture.style.visibility = 'hidden';
      setUnder(false);
      sizeAndDraw();
    };
    if (start && picture) {
      const r = canvas.getBoundingClientRect();
      const now = performance.now();
      for (const [k, at] of startedFrom) if (now - at > 10_000) startedFrom.delete(k);
      const began = startedFrom.get(start.at) ?? now;
      startedFrom.set(start.at, began);
      drawer = fromPicture(canvas, picture, tonesOf(canvas), index, r.width, r.height, began / 1000);
      // frame by frame, as a landing is: it plays when it is seen
      elapsed = now - began;
      last = now;
      if (elapsed < drawer.ms) drawer.draw(elapsed / drawer.ms);
      else handOff();
    } else if (picture) handOff();
    else sizeAndDraw();
    const draw = (t: number) => {
      if (drawer) {
        const now = t * 1000;
        elapsed += Math.min(50, Math.max(0, now - last));
        last = now;
        if (elapsed < drawer.ms) drawer.draw(elapsed / drawer.ms);
        else handOff();
      } else if (visible) field.draw(t);
    };
    const ro = new ResizeObserver(() => {
      if (!drawer) sizeAndDraw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    const offTheme = onThemeChange(() => {
      field = swirlField(canvas, tonesOf(canvas), index, formsFrom);
      if (!drawer) sizeAndDraw();
    });
    if (!still) startJob(draw);
    return () => {
      stopJob(draw);
      ro.disconnect();
      io.disconnect();
      offTheme();
    };
  }, [index, born, origin]);
  return (
    <span className="sc-rendering" aria-hidden>
      {under && origin && (
        <img ref={pictureRef} className="sc-rendering-from" src={origin.src} alt="" decoding="sync" />
      )}
      <canvas ref={ref} className="sc-swirl" />
    </span>
  );
}
