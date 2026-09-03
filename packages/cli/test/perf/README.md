# Performance rig

Deterministic fixtures and two repeatable benches. Nothing here runs in CI and
nothing asserts on timing; the numbers are evidence for a person to read.

## Fixtures

`pnpm perf:seed -- --tier small|medium|large|stress|all [--force] [--force-pool]`

Homes land under `~/.scenri-perf/<tier>/` (override with `SCENRI_PERF_ROOT`),
never `~/.scenri`, never inside the repo. Every row is written through the
store's own methods; four raw `UPDATE`s pin the timestamps the store takes from
the clock, so the timeline is the same on every seed of the same day. A marker
(`perf-fixture.json`) records tier, fixture, schema and pool versions and makes
the command idempotent. `lib/tiers.mjs` holds the counts and their reasons.

Images come from one pool of up to 1,000 unique PNGs at the real library's size
mix, calibrated to about 1.2 MB each and hard-linked into every tier. A viewport
holds about 8 tiles (Large) or 23 (Compact), so a 20-screen scroll stays inside
the unique range. What the cap under-represents: total disk footprint, and
browser cache reuse beyond the first 1,000 tiles.

## Server bench

`pnpm perf:api -- --tier large --label before [--n 20] [--hold]`

Boots one Scenri from source on a free port at or above 4798 (never 4747, never
the e2e or update-loop bands), times boot, the boot set of endpoints, brand
reads on the biggest and smallest brand, 20 node details, 20 images cold and
warm, keeper toggles and five demo generations, then restores the fixture.
A route that answers 404 is recorded as missing so the same script measures the
tree before and after a route exists. `--hold` keeps the server up for manual
Chrome DevTools traces.

## Browser bench

`pnpm perf:ui -- --tier large --label before [--url http://127.0.0.1:4798] [--headed] [--no-motion] [--screens 20]`

Playwright Chromium at 1512x982, the visual harness geometry. Measures boot to
first feed paint (3 fresh pages), a 20-screen scroll (long tasks, frames over
33 ms, image bytes per screen, layout and style work), hovering 20 tiles,
keeper click until the star paints, opening a shot (overlay, stage image,
close), switching brands both ways, typing a search, lens and sort switches,
opening the assets rail, and a browsing loop bracketed by heap readings.
Motion stays on by default because transitions are what people feel;
`--no-motion` injects the visual harness kill-switch for attribution runs.

## Baseline procedure

```
pnpm build
pnpm perf:seed -- --tier all
for t in small medium large stress; do pnpm perf:api -- --tier $t --label before; done
for t in small medium large stress; do pnpm perf:ui  -- --tier $t --label before; done
pnpm perf:api -- --tier large --label before --hold    # manual DevTools traces attach here
```

Results: `~/.scenri-perf/results/<timestamp>-<tier>-<label>-<sha>[-dirty].(api|ui).(json|md)`.
Run the `after` pass on the same seeded homes; reseed only when
`FIXTURE_VERSION` changes. Close other apps, plug in power, and keep the
machine idle; every result records the load average at start and end.
