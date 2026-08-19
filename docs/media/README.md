# Media

What the README embeds, and how to remake it.

| File | Where it appears | Notes |
|---|---|---|
| `demo.gif` | the lead, under the tagline | 960x540, 15fps, 24 seconds, 2.4 MB. The whole film, rendered at 820 |
| `demo.mp4` | not embedded | the same film, 1920x1080 H.264 at 60fps, exactly 30 seconds, 3.7 MB. Drag it into a GitHub release or issue to get a real inline video player |
| `shot.jpg` | under "What that brief produced" | the showcase hero for `marden-cole-denim-maren-editorial-walk`, which is the shot the film makes |
| `scenes.jpg` | under "What you get out of the box" | the scene library, scrolled to the grid |
| `kit.jpg` | same section | the brand kit panel |
| `hero.jpg` | same section | the four-up gallery |
| `logo-on-light.svg`, `logo-on-dark.svg` | the lead, above the tagline | the lockup, one cut per background, picked by `<picture>`. Named for the background, never the ink |
| `og.png` | not embedded | 1200x630. The GitHub social preview, which is a repository setting and has to be uploaded by hand |

The README references these with relative paths, so they render on GitHub and in any
local markdown preview. One thing to check after the first publish: npmjs.com shows the
same README to a different audience and resolves relative images against the repository,
and this package sets `repository.directory` to `packages/cli`. If the images are missing
on the npm page, swap the `src` values for
`https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/...` and they will work
in both places.

## How the film is made

`capture-native.mjs` in the private ops notes does the whole thing. No screen recorder, no
third party, no camera work: one locked-off frame of the app for the whole take. Nothing
moves except the product.

Capture is CDP `Page.startScreencast`. Frames arrive with their own timestamps and the ffmpeg
concat list carries each frame's real duration, so the encoder is told when every frame
happened rather than assuming a fixed interval.

1. Serve a scenri on a throwaway home (`cp -al ~/.scenri/content <home>/content`) on a port
   that is not 4747 or 4757, and seed a brand over `POST /api/brands`.
2. `VW=1920 VH=1080 node capture-native.mjs` for the film, `VW=1280 VH=720` for the GIF
   source, then encode.

```bash
ffmpeg -f concat -safe 0 -i frames.txt -vf "fps=60" -t 30 \
  -c:v libx264 -preset veryslow -crf 18 -tune stillimage -profile:v high -level 4.2 \
  -pix_fmt yuv420p -movflags +faststart -an demo.mp4
```

## The pointer is drawn, never dispatched

The cursor is an element in the page, animated by `requestAnimationFrame`. No mouse events
travel along its path; the only real click is the one `locator.click()` places on its own
target.

That is not a shortcut, it is the fix for two visible faults. Dispatching moves along the
path lit up the hover controls of every card the pointer crossed, so bookmark and refine
icons kept flickering on in the background. And each event was a driver round trip on the
main thread mid-animation, which is what made the motion feel laggy.

## Where the smoothness comes from

A screencast only emits a frame when the page **paints**, and a locked shot of a mostly
static interface barely paints at all. An early cut measured 31fps, so encoding at 60 was
duplicating frames: nominally 60, actually not.

- `--disable-frame-rate-limit` and `--disable-gpu-vsync` so the compositor is not capped.
- A `requestAnimationFrame` loop mutating a 3px transform, so something paints every frame.
- The pointer animation above, which is the part that mattered most.

Measured after: median gap between painted frames **9.3ms, which is 107fps**, with 90 percent
of frames arriving within 20ms. The long gaps that remain are the deliberate holds, where
nothing paints because nothing moves. That is correct, not a dropped frame.

## One capture, both deliverables

The GIF is derived from the same 1920x1080 master as the MP4, and that is not an
optimisation, it is a correctness rule. An earlier pass captured the GIF separately at
1280x720 for legibility, and because the app is responsive it laid out a **different wall**:
the video showed one grid and the GIF beside it showed another. Two captures of a responsive
interface are two different films.

So: one capture, one layout, both outputs cut from it. The GIF is written at 960 wide and
displayed at 820, which keeps the type crisp under the browser's own downscale.

Two dead ends, recorded so they are not retried. Screencast captures **CSS pixels and ignores
`deviceScaleFactor`**, so a high-DPI capture is not available that way. And `body { zoom }`
would give a large layout at native 1080p, but under CSS zoom Radix popovers mis-read pointer
coordinates and every menu click misses, which the script's own chip assertion caught.

## The rail is frozen, the wall is Large, and the dock is preset

The assets rail belongs on screen: it is the standing evidence that products, presenters and
scenes are real catalogs. What it must not do is move. Its Recent shots strip and its counts
update the moment a shot lands, so the right edge twitched at exactly the moment the eye
should be on the picture.

So the rail is **frozen rather than hidden**: the live element is cloned, the clone takes its
place in the layout, and the original is hidden. React keeps updating the hidden one and the
visible one is a still. This is a change to the recording only, never to the app.

Density is Large, and the dock is preset to **Portrait 4:5 and one variant** off camera. The
recipe is portrait 1024x1280 and exactly one image lands, so the settings on screen match the
shot being made.

## Build before you capture

The CLI serves the prebuilt `apps/studio/dist` and never builds, so `pnpm build` has to run
before a capture picks up any studio change. The film records the real interface, including
`ScenriLockup` in the top bar: an earlier cut injected the mark at record time because the app
did not have it yet, and that is exactly the drift to avoid. What is on screen is what ships.

## Length

The film is exactly 30.000 seconds. The render beat carries the slack, which is the honest
place for it: a real generation takes 60 to 90 seconds, so a longer wait there is truthful and
it gives the card's elapsed counter room to tick. A held frame paints once and then never
again, so the screencast span always stops short of the take; the last frame's duration
absorbs the difference, the concat list repeats the final file so that duration is honoured,
and `-t 30` cuts the encode to the millisecond.

One trap: the wait for the shot to land must watch **that node**, not `.sc-cell img`. Every
seeded card in the wall already has an image, so the general selector was true on the first
check and the film walked on before the picture existed. It only looked right because the
timings happened to line up.

## The ending

It stays on the picture and the brief that made it. An earlier cut closed the shot and
returned to the grid, which read as walking away from the thing the whole film was about.

## The GIF

```bash
ffmpeg -i film-720.mp4 -vf "setpts=0.80*PTS,fps=16,scale=820:-2:flags=lanczos,hqdn3d=3:3:7:7,\
split[a][b];[a]palettegen=max_colors=176:stats_mode=diff[p];\
[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" demo.gif
```

A locked camera is what keeps this small: most frames are identical to the one before. An
earlier cut with camera moves needed 10 MB for less material, because a moving camera changes
every pixel of every frame.

**Assert the output duration.** The `fps` filter silently drops the tail, and an earlier GIF
shipped 2.2 seconds short of its own source without anything reporting an error.
