# Preview imagery

Thumbnails live in the repo: one card image per scene (`<id>.jpg`), presenter
(`presenters/<id>.jpg`) and showcase entry (`showcase/<id>.jpg`).

The heavy imagery (scene reference galleries, presenter identity sets, product
shots) lives in the content archive, not the npm package: the app downloads it
once at runtime and caches it under `~/.scenri/content`. One reference gallery
(`morning-tabletop/`) is also tracked here as the repo's worked example; the
packaging script ships flat thumbnails only, so it never reaches npm.
See docs/updates.md for how the archive works and how to turn it off.
