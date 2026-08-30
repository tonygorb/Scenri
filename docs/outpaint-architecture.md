# Extending a frame: what the pipeline does, and why

Written 2026-08-26, after a full audit of the reshape path. This file exists so
no session re-derives the argument from zero, and so the approaches already
measured and rejected are not measured again.

## The question

Changing a finished shot's aspect ratio should mean "keep this picture, and add
the photograph that was outside the frame". Not "make something similar at
16:9". The original is the truth; the new pixels are the guess.

Two things have to hold at once, and they pull against each other:

1. The original must survive exactly. A Product's label, a Presenter's face and
   the composition inside the old frame are not up for renegotiation.
2. The join must be invisible. A hard boundary between two renderings of the
   same scene is the one thing the eye is superb at finding.

## What the pipeline does

`POST /api/nodes` with `kind: 'edit'` and a `reshape` discriminator. There is no
separate route and no feature flag. Crop is pure geometry and runs locally at
zero cost. Extend calls an engine and is bracketed by two sharp passes.

Whether it is really outpainting depends on the engine, and on the one that
matters it is not:

* **fal `fal-ai/bria/expand` and Replicate `bria/expand-image`** take the
  picture, the target canvas, the picture's own size and its offset, and paint
  only the margin. That is true rectangular outpainting. Both are wired and
  unit-tested. Neither has ever been run, because there is no key for either.
* **codex-cli and OpenRouter** cannot. Codex's image tool accepts
  `{prompt, referenced_image_paths, num_last_images_to_include}` and nothing
  else: no mask, no seed, no output size. So the source is laid onto a larger
  bed, the whole frame is reinterpreted, and the original is composited back
  afterwards.

No engine declares `supportsMask`. `EditRequest.mask` and `lockedAssets` are
declared in `packages/core/src/engine.ts` and read by nobody.

The preservation guarantee is therefore taken locally rather than requested from
a provider, and it holds on every engine. That is deliberate and it is not the
part that is broken.

## Root causes of the visible join

Four, all deterministic, none of them a prompt problem.

**1. The blending layer was a one-dimensional approximation of a
two-dimensional problem.** `reconcile` measured the error along the seam,
smoothed it, and multiplied it by a ramp that decayed with depth. That field is
separable: the profile along the join keeps its exact shape at every depth and
only shrinks. So whatever structure the error had at the boundary was still
printed across the margin at the far edge, merely fainter, and the ramp forced
the correction to zero at the frame border, which left a flat tonal difference
entirely uncorrected out there. Fixed, see below.

**2. The margin arrives at the wrong texture scale.** Measured, withdrawn, and
then reinstated with a different mechanism (2026-08-30). The 8-of-8
honoured-size count was real but predates the model-resize ban (`063316a`):
those exact sizes were the model force-fitting its answer with a shell resize,
which is the behaviour the ban removed. Post-ban codex delivers its native
~1.57-megapixel grid, and nothing bounded the PLAN: a 1122x1402 shot asked for
16:9 planned 2496x1402, 2.2x the budget, and the assembly upscaled the native
answer 1.49x to fill it (node d2aef33c, 2026-08-30) — soft margins against a
byte-exact centre on the composite arm, a globally resampled photograph on the
reframe arm. Fixed structurally: `reshapeRules.ts` fits the whole planned
geometry to the engine's `editPixelBudget` before anything is drawn, the
source steps down once by our lanczos, and the exact-size branch of the
assembly fires instead of its rescale. Nothing on the path upscales any more.

**3. The candidate selector was blind.** `seamScore` divides the step at the
join by the picture's own grain. It cannot see texture scale, depth of field,
grain, a line that stops dead at the boundary, a duplicated Product, or clutter
invented in the new space. The proof is on record: a fully local mirror
extension scored 0.00, a perfect join, and failed forensically eight times out
of eight, mirroring the Product into the sky. Partly fixed, see below.

**4. Placement is centred and growth is unbounded.** `planExpand` centres
unconditionally, which is the open finding from the August quality marathon:
Scenri adapts the box, not the picture. And `defaultReshapeOp` routes 16:9 to
9:16 down the extend path as a single pass that grows one axis by 3.16x, against
a published reliable band of 25 to 50 percent per pass. Placement was closed by
`outpaint/place.ts`; growth closed 2026-08-30 by `reshapeRules.ts`:
`classifyReshape` owns crop versus extend on the server, growth past 2.35x
takes a capped crop assist, growth still past 2.0x effective becomes a crop
(refused out loud when the extend was asked for by name), and the composer's
`reshapeOpFor` twin makes the hint promise the op the server will run. The
flagship 1.78x reshapes (1:1 to 16:9 and back) stay single-pass extends, which
the 2026-08-26 battery measured acceptable; the bound deliberately sits at 2.0
effective rather than SINGLE_PASS_MAX because staged growth is not built.

**One consequence worth stating plainly:** when the budget fit fires, the
preservation guarantee is byte-exact against a uniform lanczos resample of the
original at the sent size, not against the stored original. Geometry-exact
always, never sheared, recorded on the brief (`expand.frame`, `expand.source`,
`expand.assist`), and said to the user in the 202 warning.

## What was surveyed

Techniques taken: an explicit canvas and placement contract, which is already
the shape of our Bria request; compositing the original back rather than
trusting a provider, which every serious implementation does because encoding to
latent and back moves original pixels even far from the mask; boundary-local
harmonisation after compositing; bounded growth per pass; latent-block alignment
on the growth axis.

Techniques rejected: depth estimation, ControlNet conditioning, edge and normal
maps, segmentation, tiled high-resolution diffusion. All need heavyweight native
dependencies against a cross-platform npm install, and none apply to an engine
that accepts no conditioning inputs. Our target frames are far below any tiling
threshold.

On how good this can get: literal 98 out of 100 across every image is not
achievable in 2026 and is not close. Adobe Firefly is the best-funded
purpose-built implementation and still ships visible seams, absent grain and
colour-space shift as documented limitations rather than bugs. The strongest
2026 result on boundary consistency reports 82 percent user preference against
sub-32 percent baselines. Our own measurement is blunter: the same codex input
three times gave joins of 2.78, 15.07 and 2.12. What is achievable is a very
high hit rate on plain surfaces and studio sweeps, a good one on moderately
structured scenes, and honest measurement on the hard set.

### Open source consulted

Scenri is AGPL-3.0-only, which accepts MIT, BSD, Apache-2.0 and GPL-3.0 inbound.

| Project | License | Use |
| --- | --- | --- |
| `boona13/image-extender` | MIT | The closest prior art: same problem, TypeScript, no native dependencies. Two ideas taken and credited below. No code copied. |
| `Trinkle23897/Fast-Poisson-Image-Editing` | MIT | Reference for solver convergence behaviour. |
| `cheind/poisson-image-editing` | GPL-3.0 | Compatible, but C++ and not needed. |
| `takuti/poisson-image-blending` | none | No license file, so ideas only. |
| OpenCV `seamlessClone` | Apache-2.0 | Rejected on dependency grounds, not licence: an 8MB WASM build or a native one is a cross-platform install hazard. |

## What changed

The blending layer is now a solved harmonic field rather than a ramp.

`packages/cli/src/outpaint/membrane.ts` solves Laplace's equation on the margin
rectangle: Dirichlet on the line that touches the picture, Neumann on the other
three, so the correction can reach the frame border instead of being forced back
to zero there. Red-black successive over-relaxation on a coarse-to-fine cascade.
Over-relaxation matters: plain Gauss-Seidel needs on the order of n squared
sweeps to carry information across n cells, which is why fixed-iteration
implementations of this are usually far from converged.

`reconcile` in `packages/cli/src/expand.ts` now splits the seam error into the
part whose continuation is already known and the part that has to be solved.

A plane, meaning a constant plus a slope along the join, satisfies Laplace
exactly, so it is a valid correction at any depth. The solver would still bleed
it away, because the zero-gradient condition at the ends of the strip is a
boundary the picture does not actually have. A bulk tone difference and a
lighting falloff along the join are both planes, and both are properties of the
whole margin rather than of its edge. So the plane is fitted first and applied
across the full depth, and only the remainder goes to the solver. It is fitted
through the medians of the two halves of the seam rather than by least squares,
so a dark object standing against part of the frame edge tilts nothing.

### Measured against a real photograph

A real 1024 by 1024 shot from the library is the ground truth. Its centre 576 by
1024 column is treated as the shot we already have, and the strips either side
are what a perfect extension would produce. The engine's answer is that truth
with the margins carrying what two renderings of one scene differ by: a
per-channel bulk shift, a lighting falloff along the join, and a mid-frequency
ripple. Mean absolute error against the true photograph, in levels, averaged
over four images.

With an 8 level falloff:

| Margin region | Uncorrected | Old ramp | Solved membrane |
| --- | --- | --- | --- |
| whole margin | 8.63 | 4.69 | 3.59 |
| first 20 px | 8.68 | 1.43 | 2.15 |
| middle | 8.61 | 4.58 | 3.83 |
| outer 24 px | 8.64 | 8.27 | 3.75 |

With a 30 level falloff:

| Margin region | Uncorrected | Old ramp | Solved membrane |
| --- | --- | --- | --- |
| whole margin | 14.96 | 7.90 | 4.13 |
| outer 24 px | 15.01 | 14.28 | 4.29 |

Two things to read honestly. The ramp does essentially nothing at the frame
edge, 8.27 against 8.64 uncorrected, and 14.28 against 15.01 once the falloff is
a real size. That is structural, because its correction decays to zero there by
construction. The membrane plus the plane removes both the bulk shift and the
falloff at every depth, and what is left at the outer edge, 3.75, is almost
exactly the mean absolute value of the injected ripple, 3.82, which is the
component that should decay.

The ramp is better in the first 20 pixels, 1.43 against 2.15. That is an artefact
of the error model rather than a defect. The simulation applies the same error at
every depth, so a correction that stays at full strength wins near the join. Real
generated content diverges from anything the boundary predicts as it travels
inward, which is exactly why a harmonic prior makes no claim beyond the boundary.
The components that genuinely are properties of the whole margin are the ones now
carried across all of it.

Cost is 41 to 145 ms at real margin sizes, against a generation that takes about
a minute.

`packages/cli/src/outpaint/score.ts` adds the plain measurement to sit beside
`seamScore`: mean absolute channel difference across the join, sampled four
pixels either side, with the published reading of under six invisible and over
fifteen clearly visible. The two numbers fail in opposite directions, so the
best-of-two selector now ranks on the worse of the two rather than on the grain
ratio alone. A flat studio sweep has no grain to divide by, which is exactly
where `seamScore` used to give up.

The preservation guarantee is unchanged and still asserted byte for byte. The
solver only ever writes inside a margin.

## What Phase A settled, and what it cost

The plan after the first pass was to replace the bed with a structure-aware
guide, on the argument that `expandCanvas` magnifies the picture 1.78x and
centre-crops it, so the margin carries the wrong texel size, rows that no longer
correspond, and content that contradicts the picture at the join. The supporting
measurement is real: gradient energy varies 8.35x down a cracked-clay frame and
1.23x across it, and that vertical spread ranks the four golden sources in
exactly the order they failed.

Before writing the guide, one belief was tested: **does codex respect the guide
it is handed at all?** Three arms, the source being the centre 576x1024 column of
a real shot grown back to 1024x1024, so the true margins exist and the answer can
be scored against them.

| clay, n=5 | seamScore | residual | MAE against the true photograph |
| --- | --- | --- | --- |
| control, today's bed | 2.93 | 13.24 | 15.21 |
| guide, row-wise at 1:1 | 2.41 | 13.50 | 15.20 |
| oracle, the picture's own true margins | 3.49 | 15.34 | 15.97 |

Handed the best guide that can physically exist, codex came back no better than
with the magnified blurry one. If guide quality were the lever, a perfect guide
would have shown a large effect at five runs. It showed none, so `guide.ts` was
never written.

Two caveats on the record. Only clay completed five runs per arm; sweep managed
four and the other two hard sources ran out of Codex plan quota, which 60 runs
exhausted in about 25 minutes. And at this variance no arm is separable from
another, which is itself the point rather than a hedge.

## What shipped

- `outpaint/membrane.ts` and the plane extraction in `expand.ts`, above.
- `outpaint/score.ts`, the calibrated seam residual, ranked against `seamScore`
  by normalising each to its own threshold and taking the worse of the two.
- `outpaint/texture.ts`, the three measures the seam metrics are blind to:
  texture scale, defocus and subject duplication, all band by band along the
  join because a single number for the whole join averages away the 8.35x. They
  are reported and not enforced; every threshold needs a battery behind it.
- `outpaint/place.ts`, subject-aware placement. The picture keeps the relative
  position it held, so a bottle composed against one edge is not dropped into
  the middle of a frame it was never shot for. Clamped so neither side is
  starved of context, and softened toward the centre the same way
  `attentionCropOrigin` is. This closes the marathon's open P2 finding.
- `outpaint/growth.ts`, a bound on how far one pass may grow. 16:9 to 9:16 was
  asking for 3.16x in a single pass with nothing to stop it.
- `outpaint/route.ts`, so an extend resolves its own engine. A shot made on
  codex may be extended by a real outpainter, because an extend needs no
  identity references: the Product and the Presenter sit inside the protected
  region. Cost, the spend cap and the provenance badge all follow the engine
  that actually ran, and the brief records the method, the engine and where the
  protected picture sits.

## The 2026-08-26 battery, and the rule it produced

Sixty-four real codex runs, six shots, eight strategies, one ratio (1:1 to 16:9).
Driver: `packages/cli/test/manual-extend-battery.mts`. Report and every
artifact, failures included: `scenri-ops/extend-bakeoff-2026-08-26/`.

### The capability question, settled first-hand

Codex's built-in `image_gen` takes `{prompt, referenced_image_paths,
num_last_images_to_include}` and nothing else. No mask. No seed. `size`,
`quality` and `background` are hardcoded to `auto` in the request builder and
unreachable from the tool arguments
(`codex-rs/ext/image-generation/src/tool.rs`). Verified against 89 real tool
calls in `~/.codex/sessions`.

The BYOK Images API does expose a `mask` — and documents it as "prompt-based…
may not follow its exact shape with complete precision". So there is no tier
where a provider hands back an untouched region. **Pixel identity on any path we
can reach comes from our own compositing, never from the provider.**

`MAX_EDIT_IMAGES` is 5, which is why `maxReferenceImages` is 5 and not 6: the
sixth attachment is not a sixth reference, it is an eviction of the first, and
on an edit the first is the shot itself.

### Conditioning and wording are not the lever

Eight arms. Padded frames at native scale, edge fills, transparent fills,
preservation wording, reframe wording, an explicit unchanged-axis geometric
anchor, identity references, and today's blurred bed. Every padded arm landed
between **0.66 and 0.72** fidelity, inside one standard deviation (~0.21) of
each other. Only dropping the padding entirely was clearly worse (0.53).

This is the same answer Phase A gave from the other direction, and the two
together should be treated as settled: **you cannot prompt or condition your way
out of this on a route with no mask.** Do not spend another battery on wording.

### The assembly is the lever, and it separates per shot

| assembly | fidelity | seam |
|---|---|---|
| composite the original back | 1.000 | 0.77, 0.79, 0.79, 0.86, 1.19 — and **7.65** |
| keep the model's own frame | 0.66-0.72 | 0.60-0.67, invisible everywhere |

Five shots of six cost nothing to preserve exactly. The sixth — a tight crop of
a room, where the margin has to invent architecture that lines up with the
original's perspective — is where compositing shows, and where the model's own
frame scored 0.95 fidelity at a seam of 0.74.

So the two draws stopped being two tries at one request and became two
candidates. And then BOTH get composited, which is the part that was nearly
missed: compositing had only ever been measured on the bed-conditioned answer.
Run over the padded answers already on disk — no quota, they were already drawn
— the two conditionings turn out to disagree about which shots they can carry.
On `presenter`, the shot that fails worst, the bed answer joins at **7.65** and
the padded answer at **1.68**. Invisible. Side by side the difference is not
subtle: one has a washed-out band with the table edge stepping across it, the
other continues the table, the window frame and the cabinets.

Overall the bed answer composites better (1.71 mean against 2.61), so it is not
that the padded answer is simply better to paste — it is that they fail on
different shots, and taking the better of the two joins costs one local
composite and no draw.

The rule is therefore: composite every draw, rank by the join, keep the exact
pixels unless **neither** composite can hide it, and only then fall back to the
model's own frame. Over the six shots that keeps the photograph byte for byte on
every one of them with nothing visible anywhere — where ranking the bed
composite alone would have surrendered the picture on one shot in six.
`packages/cli/src/outpaint/choose.ts`,
`packages/cli/test/manual-extend-onedraw.mts`.

One draw does not serve both candidates, which was the other question this
answered. The bed's blurred margin is what makes an answer composite cleanly;
the padded frame's honest scale is what makes one stand alone. Asking for both
is the cost of having both.

### The shared failure mode of every no-mask arm

Not identity drift, not text drift, not hallucination. The model **widens the
lens**: it keeps the world and re-shoots it from further back. Products stay
themselves, logos stay legible — the tech shell's mark came back as readable
"NOVARA / FIELD SUPPLY" every time — and everything gets smaller. On a source
whose subject is cropped at the frame edge it is dramatic: a tight torso crop
came back as a full room with the whole face visible.

Two things worth carrying:

- An identity reference can **argue with the framing**. The worst fidelity in
  the batch was a presenter shot whose reference shows a face and whose source
  crops the head off; the model pulled back far enough to show one.
- The fidelity number is for ranking, not grading. It cannot tell an
  unacceptable product drift from an acceptable regenerated texture, and a
  visually excellent result scored 0.59 on marble. Every finalist gets looked
  at, which is what the `-crop.png` artifact is for.

## What is still open

1. **A masked model.** This is the only lever left standing. `fal-ai/bria/expand`
   and `bria/expand-image` are wired, unit-tested and have never been executed,
   because there is no key. The route above means adding one is the whole change.
2. **Thresholds for the texture measures**, which need a real battery.
3. **Staged growth.** `planGrowth` reports how many passes a reshape ought to
   take; executing more than one is not built, and cannot be validated while the
   guide question is answered the way it is.
4. **The other three hard sources**, which quota cut short.

- **The reference policy for an extend.** Identity references are mildly
  positive on most shots and rarely catastrophic, and the mean is entirely the
  catastrophe: +0.18 on `studio`, +0.13 on `logo`, +0.07 on `pair`, ~0 on
  `lowkey`, -0.08 on `clay`, and **-0.70 on `presenter`**. Mean -0.07, spread
  0.32.

  The hypothesis the failure suggests is specific rather than "references are
  bad": `presenter` is a tight crop with the subject's head cut off above the
  frame, and its reference shows a face. Handed both, the model pulled the
  camera back far enough to show one. So the risk looks like a reference whose
  FRAMING contradicts the source's framing, not identity reinforcement as such.

  Left exactly as it was, because n=1 on the shot that carries the whole result.
  The next battery should test it directly: several sources whose subject is
  cropped at the frame edge, with and without a reference that shows the subject
  whole.
- **The other ratios.** The battery ran 1:1 to 16:9 only. 9:16, 4:5 and the
  chains (extend, extend again, refine) are unmeasured.

## Already tried, do not repeat

Measured on 2026-08-25 across roughly 60 real codex generations: perspective
language in the prompt, the image tool's own labelled schema, asymmetric
placement judged on seam quality, two-step expansion, a mirror-fill bed, fully
local mirror extension, and parallel best-of-two. None reached a reliably
invisible join. Naming grain in the instruction made margins measure 39 percent
grainier. A feathered alpha band at the seam and a mean-tone margin match were
both built and both removed, the first because every pixel it softened was a
pixel of the original diluted, the second because one number cannot describe an
error that varies along the join.

Asymmetric placement is worth revisiting, but for composition and judged on
composition. It was rejected against a seam metric it does not affect.

## Credit

The gradient-domain technique is Perez, Gangnet and Blake, "Poisson Image
Editing", SIGGRAPH 2003.

Two ideas came from reading `boona13/image-extender` (MIT): removing the flat
colour difference before solving, because a uniform shift leaves the Laplacian
unchanged while taking out the slowest-converging mode; and measuring the join
as a plain level difference a few pixels either side, with the calibration that
makes that number readable. Our solver, its boundary conditions, the cascade and
the median statistic are our own, and the mask is never grown into the original,
because that would cost the guarantee this feature exists to make.
