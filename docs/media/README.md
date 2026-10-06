# Media

What the README embeds, and what each file is.

| File | Where it appears | Notes |
|---|---|---|
| `demo.gif` | the lead, under the tagline | 1280x720, 15fps, 27 seconds, 3.4 MB, shown at 820. Cut at 0.8x from the same master as `demo.mp4`, so both show one layout |
| `demo.mp4` | not embedded | the film, 1920x1080 H.264 at 60fps, 33.8 seconds, 4.5 MB. Drag it into a GitHub release or issue to get a real inline video player |
| `readme-*.jpg` | the eight-shot grid under "What a prompt produces" | 720x900, cut from the library's own 1536x1920 pictures, each named for its shot |
| `library.gif` | under "What you get out of the box" | 880x496, 12fps, 11.8 seconds, 7.5 MB. Home, then the People and Places libraries, cut at 0.8x from the same master as `library.mp4` |
| `library.mp4` | not embedded | the same film, 1920x1080 H.264 at 60fps, 14.7 seconds, 18.2 MB |
| `logo-on-light.svg`, `logo-on-dark.svg` | the lead, above the tagline | the lockup, one cut per background, picked by `<picture>`. Named for the background, never the ink |
| `og.png` | not embedded | 1200x630. The GitHub social preview, which is a repository setting and is uploaded by hand |

The README references these with absolute `https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/...`
URLs. npmjs.com renders the README against the package's own directory (`packages/cli`), where a
relative path breaks, and `packages/cli/test/readmeLinks.test.ts` keeps markdown links absolute. Two
consequences: a new picture shows on GitHub and on npmjs.com as soon as it is on `main`, while the
README's words reach npmjs.com only with the next release; and a file the published README still
names stays in this folder until that release is out.

Every film is one capture of the real app from a throwaway library holding only public demo
content, made with the `product-video` skill: nothing generates on camera, and the finished picture
is a real Home example (or, for a refinement, a real refinement Scenri made from it). A GIF over
about 10 MB stops rendering through GitHub's image proxy, so the scrolls stay short.
