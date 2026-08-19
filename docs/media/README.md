# Media

What the README embeds, and what each file is.

| File | Where it appears | Notes |
|---|---|---|
| `demo.gif` | the lead, under the tagline | 960x540, 15fps, 24 seconds, 2.4 MB. The whole film, rendered at 820 |
| `demo.mp4` | not embedded | the same film, 1920x1080 H.264 at 60fps, exactly 30 seconds, 3.7 MB. Drag it into a GitHub release or issue to get a real inline video player |
| `readme-*.jpg` | the eight-shot grid under "What a brief produces" | derived from `templates/previews/showcase/`, 720x900, each named for its shot |
| `scenes.jpg` | under "What you get out of the box" | the scene library, scrolled to the grid |
| `kit.jpg` | same section | the brand kit panel |
| `logo-on-light.svg`, `logo-on-dark.svg` | the lead, above the tagline | the lockup, one cut per background, picked by `<picture>`. Named for the background, never the ink |
| `og.png` | not embedded | 1200x630. The GitHub social preview, which is a repository setting and is uploaded by hand |

The README references these with relative paths, so they render on GitHub and in any
local markdown preview. One thing to check after the first publish: npmjs.com shows the
same README to a different audience and resolves relative images against the repository,
and this package sets `repository.directory` to `packages/cli`. If the images are missing
on the npm page, swap the `src` values for
`https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/...` and they will work
in both places.
