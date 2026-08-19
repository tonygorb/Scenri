# Media

What the README embeds, and how to remake it.

| File | Where it appears | Notes |
|---|---|---|
| `demo.gif` | the lead, under the tagline | 820x512, 15fps, about 13 seconds, 2.7 MB |
| `demo.mp4` | not embedded | the same capture, H.264. Drag it into a GitHub release or issue to get a real inline video player |
| `shot.jpg` | under "What that brief produced" | the showcase hero for `kenji-wavelength-listening` |
| `scenes.jpg` | under "What you get out of the box" | the scene library, scrolled to the grid |
| `kit.jpg` | same section | the brand kit panel |
| `hero.jpg` | same section | the four-up gallery |

The README references these with relative paths, so they render on GitHub and in any
local markdown preview. One thing to check after the first publish: npmjs.com shows the
same README to a different audience and resolves relative images against the repository,
and this package sets `repository.directory` to `packages/cli`. If the images are missing
on the npm page, swap the five `src` values for
`https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/...` and they will work
in both places.

## Remaking the demo

The capture is scripted rather than screen-recorded, so it can be remade exactly.

1. Run a scenri on a throwaway home so nothing touches your real library. Hardlink the
   content cache into it (`cp -al ~/.scenri/content <home>/content`), which is instant and
   costs no disk, then start the server with `SCENRI_HOME=<home>` and a port that is not
   4747 or 4757.
2. Seed a brand over `POST /api/brands`.
3. Drive the composer with Playwright and `recordVideo` at 1280x800: type `$` and pick the
   product, `@` and pick the presenter, `/` and pick the look, then press Generate with
   `POST /api/nodes` intercepted so the app shows its real generating state without
   reaching an engine.
4. Encode with ffmpeg. One palette for the whole clip, `stats_mode=diff`, bayer dithering:

```bash
ffmpeg -i capture.webm -vf "setpts=0.85*PTS,fps=15,scale=820:-2:flags=lanczos,split[a][b];\
[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" demo.gif
```

Keep it under 5 MB. GitHub will not autoplay anything larger, and a still frame is worse
than no image.

**Do not put a photograph in the GIF.** The payoff shot lives beside the GIF as a JPEG for
a reason: one 256-colour palette cannot hold both a dark interface and skin tones, and the
face bands badly. Per-frame palettes fix the banding and take the file past 35 MB.
