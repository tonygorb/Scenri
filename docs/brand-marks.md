# Brand marks in generation

What Scenri promises about a brand logo, stated once.

A brand mark reaches a model exactly one way: the user places a mark chip in the brief, and the
compiler attaches the original stored PNG (content-addressed, full resolution, never a thumbnail)
as a reference with the explicit `brand` role. The prompt tells the model the mark is this brand's
own artwork and must appear exactly as drawn wherever the direction asks for it.

That is generative reproduction, not compositing. Scenri guarantees the correct canonical asset is
sent, prioritized ahead of inspiration references and carried through refinement; it cannot
guarantee the model's rendering is pixel-faithful, because the provider redraws the image. Where
letterforms mutate despite a correct payload, that is a provider limitation, not a pipeline bug.
Deterministic post-generation logo compositing (for packaging, signage, billboards) is a possible
future feature and is deliberately not part of this contract.

The rest of the contract:

- The kit holds one primary mark at a time; promoting one demotes the incumbent, and every
  surface that asks "which is the logo" resolves it the same way.
- On an engine that reads no reference images, the shot still runs: the composer says before
  sending that the mark will ride as text only, and the send response repeats it.
- A refinement carries the source shot's mark unless it was removed, and says so if the mark has
  since left the kit.
- Built assets (products, presenters, scenes) exclude logos by design: they are neutral raw
  material, and the mark is applied per shot via the chip.
