# Media

## demo.gif (required before the repo goes public)

The README embeds `docs/media/demo.gif`. Until it exists the README shows a
broken image, so record it before making the repository public.

What it should show, in 10 to 15 seconds, no captions:

1. a shot generating
2. branching an edit from it
3. the compare view, with the drift heatmap
4. keeping the winner

Aim for under 5 MB. GitHub will not autoplay anything larger, and a still frame
is worse than no image. `ffmpeg` plus `gifski` gives the best size-to-quality
result; capture at 1280 wide and scale to 820 to match the README.
