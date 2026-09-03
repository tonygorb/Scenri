/**
 * Instrumentation injected into every page the UI bench drives, as one string
 * (Playwright's addInitScript takes source, not modules).
 *
 * Long tasks, input events over 16 ms and LCP are observed for the life of the
 * page; a rAF sampler records frame times only while a section is open; and
 * `__perf.until(cond)` resolves with performance.now() at the first painted
 * frame in which the condition holds, which is how every interaction is timed
 * from the page's own clock.
 */
export const INPAGE = `
window.__perf = { section: null, sections: {}, longtasks: [], events: [], frames: [], lcp: null };
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) __perf.longtasks.push({ section: __perf.section, t: e.startTime, d: e.duration });
  }).observe({ type: 'longtask', buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) __perf.events.push({ section: __perf.section, name: e.name, t: e.startTime, d: e.duration });
  }).observe({ type: 'event', durationThreshold: 16, buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) __perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
} catch {}
(function () {
  let last = performance.now();
  const tick = (t) => {
    if (__perf.section) __perf.frames.push({ section: __perf.section, d: t - last });
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
__perf.begin = (name) => { __perf.section = name; __perf.sections[name] = { at: performance.now() }; };
__perf.end = () => { __perf.section = null; };
__perf.take = (name) => ({
  longtasks: __perf.longtasks.filter((x) => x.section === name),
  frames: __perf.frames.filter((x) => x.section === name).map((x) => x.d),
  events: __perf.events.filter((x) => x.section === name),
});
__perf.until = (cond, timeout = 120000) => new Promise((resolve, reject) => {
  const t0 = performance.now();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    mo.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
  };
  const check = () => {
    if (done) return;
    let ok = false;
    try { ok = !!cond(); } catch { ok = false; }
    if (ok) return finish();
    if (performance.now() - t0 > timeout) { done = true; mo.disconnect(); reject(new Error('timeout')); }
  };
  const mo = new MutationObserver(check);
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  (function poll() { if (done) return; check(); if (!done) requestAnimationFrame(poll); })();
});
`;
