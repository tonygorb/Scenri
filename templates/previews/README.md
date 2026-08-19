# Preview imagery

Thumbnails live in the repo: one card image per scene (`<id>.jpg`), presenter
(`presenters/<id>.jpg`) and showcase entry (`showcase/<id>.jpg`).

The heavy imagery (scene reference galleries, presenter identity sets, product
shots) is not in the repo or the npm package. The app downloads it once at
runtime from the content archive and caches it under `~/.scenri/content`.
See docs/updates.md for how that works and how to turn it off.
