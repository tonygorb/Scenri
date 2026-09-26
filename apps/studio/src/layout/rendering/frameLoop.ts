/**
 * Every canvas drawing a picture being made shares one requestAnimationFrame
 * loop, at the display's rate: one callback per frame however many tiles are
 * waiting, and none at all while nothing is.
 */
type Job = (t: number) => void;

const jobs = new Set<Job>();
let raf = 0;

const loop = (now: number) => {
  raf = requestAnimationFrame(loop);
  for (const j of jobs) j(now / 1000);
};

/** Draws `j` on every frame from the next one, with the time in seconds on the performance clock. */
export function startJob(j: Job) {
  jobs.add(j);
  if (!raf) raf = requestAnimationFrame(loop);
}

export function stopJob(j: Job) {
  jobs.delete(j);
  if (!jobs.size && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}
