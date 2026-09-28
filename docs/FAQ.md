# FAQ

Short answers to the questions people ask first. The words used here are defined in
[Concepts](CONCEPTS.md).

## Why reference images and not a LoRA?

A LoRA teaches one open model one face, product or style. Scenri is the workspace around a model
instead: which products, people and places a brand has, which shots worked, and how to make the next
one match. It trains nothing. It sends your saved photos with each shot as reference images, so a
new person or product is usable the moment it is saved, with no dataset and no training step, and
nothing needs retraining when a better model ships.

A LoRA is the better tool when you want open weights running on your own hardware with no per-image
fee, a seed you can pin to reproduce a picture exactly (in Scenri, Try again is always a new take), a
locked style, thousands of reuses of one subject, or many angles of it. If you already run trained
LoRAs on your own machine, Scenri will not beat that on faces.

Neither approach makes logos and small text exact. Scenri redraws products from their photos too; see
[Is the product in the picture exact?](#is-the-product-in-the-picture-exact)

## Why not just use ChatGPT?

The default engine is Codex CLI, OpenAI's own tool, drawing on the same ChatGPT plan you already pay
for. What Scenri adds is around the picture: a saved library of the brand's products, people and
places, a one-line prompt that attaches the right reference photos every time, and each shot's recipe
and refinement trail, so the tenth shot matches the first. If you make one image a week, ChatGPT on
its own is enough.

## Which engine should I use?

| Engine | Needs | Reference images per shot |
|---|---|---|
| **Codex CLI** (the default) | a paid ChatGPT plan; Scenri installs Codex CLI and signs you in | up to 5 |
| OpenRouter | an API key; draws with `google/gemini-2.5-flash-image` | up to 4 |
| Replicate | an API token | none |
| fal | an API key | none |

Use Codex CLI if you have a paid ChatGPT plan, and OpenRouter if you do not. Replicate and fal take no
reference images, so Scenri refuses a shot that names a product or a presenter on them rather than
drawing a product or a face that only looks right: the refusal says the engine cannot carry the
reference images and asks you to choose another engine or remove that chip. A logo on those engines
rides as words only, and the composer says so before you send.

Scenri needs Codex CLI 0.157.1 or newer; the [install guide](INSTALL.md#troubleshooting) covers
updating it.

## What does it cost?

Scenri charges nothing and sells no credits. You pay the provider directly.

- **Codex CLI** counts against your ChatGPT plan's Codex usage. OpenAI meters that, not Scenri, so
  spend caps do not apply to it, and Scenri records Codex shots at no cost.
- **OpenRouter** bills you itself. For each image Scenri records the cost OpenRouter reports, and
  about $0.04 an image when it reports none.
- **Replicate** is recorded at about $0.003 an image and $0.04 an edit; **fal** at about $0.003 an
  image and $0.025 an edit. fal bills per megapixel, so its own bill can differ from Scenri's
  figure.

Set a monthly cap for each paid engine in Settings, Providers. Generation stops before a cap is
crossed.

## Is the product in the picture exact?

No, and Scenri does not pretend it is. A new shot is generative reproduction: Scenri sends the
product's own photos (and your logo, when its chip is in the prompt) as reference images, and the
model redraws them. Scenri guarantees the right pictures reach the model, not that the model's
rendering is pixel-faithful, so a product can come out slightly different from its photos and
lettering can change shape. The full statement for logos is in [brand-marks.md](brand-marks.md).

Two operations do keep original pixels, restored on your computer rather than redrawn by the
engine. Refining one part of a finished shot (adding a prop, removing an object) keeps everything
outside that change exactly as it was. Changing a shot to a wider or taller shape keeps the original
photograph and draws only the new margin, wherever that leaves no visible join; a tighter shape is a
crop.

## Can I use the pictures commercially?

Two sets of terms apply, and this is not legal advice. What you may do with a picture an engine drew
is governed by that provider's terms: OpenAI for Codex CLI, and OpenRouter, Replicate or fal and the
model behind them for the others. Scenri's bundled library imagery is covered by
[ASSETS-LICENSE.md](ASSETS-LICENSE.md): free to use within Scenri, commercial work included, and
everything you generate with it is yours; the library itself may not be redistributed.

## Does it work offline? Does it send my data anywhere?

Scenri runs on your own computer, and the desktop icon starts it without an internet connection.
Making a picture needs the provider, so generation needs the internet.

When you generate, the prompt and its reference images go straight from your computer to the one
engine you connected, and nowhere else. On its own behalf Scenri makes, in the words of
[PRIVACY.md](../PRIVACY.md), "exactly two requests, both disclosed in the terminal the first time they
run, and both optional": a version check against npm every six hours (with the download of a newer
release when there is one), and the download of the library imagery archive from GitHub. Both carry
no identifier, no telemetry and no user data, and both can be turned off. PRIVACY.md also lists the
smaller cases, such as a product's first photo going to Codex once so it can read the product's size.

## Video?

No. Video is a different craft with different tooling, and it is not planned for `0.x`; see the
[roadmap](../ROADMAP.md).
