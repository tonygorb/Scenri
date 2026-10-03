# Concepts

The words Scenri uses. How to do each thing is on its own page.

## Brand

**Brand.** One client or label. It has its own kit, Products, Presenters, Scenes, and Shots.

**Brand kit.** Name, logos, colours, and a short list of things the brand never shows. It lives in Settings, **Brand kit**. [Brand kit](BRAND.md).

**`.brand` file.** The kit as a zip you can move: `brand.json` and an `assets/` folder. It does not contain keys. The format is Apache-2.0. The app is AGPL-3.0-only. [Your files](FILES.md).

## Ingredients

**Product.** Something the brand sells, saved from its own photos or imported from a store. A Shot sends those photos as reference images. The model redraws the Product from them. [Products](PRODUCTS.md).

**Presenter.** A person the brand uses again. You describe someone, or start from photos, then approve the face Scenri draws. These docs say Presenter, which is the word in the app. [Presenters](PRESENTERS.md).

**Scene.** The place, the light, and the treatment. It is not the person. A Scene can be shot with nobody in it. [Scenes](SCENES.md).

**Library.** What you can pick: 30 Products, 19 Presenters, and 42 Scenes that ship with Scenri, plus the ones you make. The Home wall has 110 example Shots made from that library. Open one and it loads back into the line.

## A Shot

**The line.** What you write in Create. `$` is a Product, `@` a Presenter, `/` a Scene, `#` a colour. Each becomes a chip. **+** adds a logo, a finished Shot, or a picture of your own. One Shot holds up to 12 of those identities together. [Create a Shot](CREATE.md).

**Shot.** One picture, one card. Asking for 2, 3, or 4 makes that many cards.

**Recipe.** The line, the chips, and the settings, kept with the Shot. Try again runs it once more. Reuse setup puts it back in the composer so you can change it.

**Refine.** Open a Shot and say what to change. Each step stays on a trail under the picture, the original first. [Refine a Shot](REFINE.md).

## Order

**Keepers.** Shots you mark, and the same mark on a Product, Presenter, or Scene. Create has a Keepers tab. Each library page has one too. [Keepers and sets](KEEPERS.md).

**Archived.** Put away, not deleted. An archived Shot leaves All and Keepers until you restore it.

**Set.** A named group of Shots inside Create, such as a campaign. It is not a place in the top bar. A Set is not the several cards from one line. Those are separate Shots.

## Generation

**Provider.** What draws the picture: Codex on a paid ChatGPT plan, or OpenRouter, Replicate, or fal with your key. Scenri writes the prompt and chooses the reference images. The provider draws. [Connect image generation](CONNECT.md).

Questions about LoRA, cost, and whether the Product is exact are in the [FAQ](FAQ.md).
