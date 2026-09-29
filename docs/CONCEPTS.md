# Concepts

The words Scenri uses, each in a sentence or two, in the app's own terms. Questions such as why
Scenri uses reference images instead of training, or what it costs, are in the [FAQ](FAQ.md).

## Save once, shoot in one line, refine on the trail

1. **Save once.** A brand's products, the people in its shots and its places are saved as
   ingredients you reuse, together with its brand kit.
2. **Shoot in one line.** A shot is one line in the composer: chips for what, who and where, and
   your own words for the direction. Scenri sends the saved photos with it as reference images to
   the image model you connected.
3. **Refine on the trail.** Open the shot and say what to change. Every step stays on a trail under
   the picture, and every shot keeps the recipe that made it.

## The brand

**Brand.** One client or label, and the top of everything else. Each brand has its own kit, its own
products, presenters and scenes, and its own shots.

**Brand kit.** The brand's name, logo, palette and rules, set once in Settings, Brand kit and carried
into every shot that asks for them. Paste a website and Scenri drafts the kit from its public pages.

**`.brand` file.** The kit as an open, portable file: a ZIP holding `brand.json` and an `assets/`
folder, under Apache-2.0 so any tool can read and write it. It never carries keys, so it is safe to
email. The format is specified in [packages/brand-spec](../packages/brand-spec/SPEC.md).

## Ingredients

**Product.** Something the brand sells, saved from its real photos, uploaded or imported from a store
(Shopify, WooCommerce, Webflow, or a generic reader for other sites). The photos travel with each
shot, and the model redraws the product from them. A product also carries its real size, read once
from its first photo when Codex CLI is connected and changeable in its Details, so shots draw it at
scale.

**Presenter.** A recurring person in the brand's shots. These docs say people; the app calls them
Presenters. You make one in a short conversation: describe someone or start from photos, approve the
face, then the further views drawn from it. Every edit is a new version you can step back through.

**Scene.** A place, the where of a shot. Make one from a sentence, from a few guided questions (Guide
me), from pictures of a place or from one of your own shots; it is drawn as the place and as the place
in use. Your pictures set the mood and are never copied, and a scene with nobody attached is shot
without a stand-in person.

**Library.** Everything you can pick from: Scenri's own 30 products, 19 presenters and 42 scenes,
plus the ones you make. Star one on its own page to keep it. Scenri's imagery is downloaded on the
first start and is licensed under [ASSETS-LICENSE.md](ASSETS-LICENSE.md).

**Examples.** The 110 finished shots on the Home wall, each made from the library. Open one and it
loads back into the composer as the prompt that made it, ready to change.

## Making a shot

**The prompt and its chips.** The line you write in the composer. `$` reaches for a product, `@` a
presenter, `/` a scene and `#` a colour, and each becomes a chip carrying the picture it stands for;
everything between the chips is your own words. The **+** beside the prompt adds the rest: your logo
as a mark chip (from the Brand tab), finished shots, and pictures of your own (Upload image or
paste). One shot holds up to 12 products, presenters, marks and pictures together.

**Shot settings.** Beside the prompt: the shape (Square 1:1, Portrait 4:5, Story 9:16, Landscape
16:9), how many shots to make (1 to 4) and the resolution (Draft, Standard or High). A new prompt
starts at Portrait, one shot, Standard.

**Reference images.** The pictures that travel with a shot to the engine: product photos, a
presenter's views, the scene, your logo and anything you added. Codex CLI carries up to 5 and
OpenRouter up to 4; a chip the engine cannot show as a picture rides along in words, and says so.
Replicate and fal carry none (see [Engines](FAQ.md#which-engine-should-i-use)).

**Shot.** One picture made from one prompt, shown as its own card in Create. Asking for several
gives that many cards, made together.

**Recipe.** What a shot was made from: its prompt, its chips and the settings it ran at, kept with
the shot. It is what Try again runs, what Reuse setup and the Home examples reopen, and what makes the
next shot match.

**Refine and the trail.** Open a shot and say what to change. Each refinement joins the trail under
the picture, the original first, so every step stays one click apart and any step can be refined
again. A change to one part keeps the rest of the picture as it was, down to the pixel; a change that
affects the whole frame, like new light, is free to redraw it.

**Try again.** Runs the same setup once more, for a different take. On a failed or stopped shot, it
runs again in the same card.

**Reuse setup.** Starts a new shot in the composer from this one: the same prompt, chips, shape and
count, ready to change. It is for "like this one, but", where Refine is for changing this picture.

## Keeping order

**Keepers.** The shots you star. The Keepers tab in Create shows only them. The same star keeps a
product, presenter or scene on its own page.

**Archived.** Put away, not gone. An archived shot leaves All and Keepers and waits under Archived
until you restore it or delete it.

**Sets.** Named folders for shots, such as a campaign or a client round. A set is a place in Create
with its own address, you add shots to it from the selection bar, and Not in a set shows the shots no
set has claimed.

**The other meaning of "set".** Release 0.7.1 also used set for the 2, 3 or 4 shots you get from one
prompt: they are variations of one shot, holding the product, the person, the scene and the brand
while the camera, crop or pose changes. Since 0.7.5 each of those lands as its own card, and in the
app today a set always means a named folder.

**Drafts.** Unfinished work kept for you. A presenter or scene you leave partway is saved as a draft
and offered back on the Presenters or Scenes page. The prompt you were writing is kept for each brand
in this browser, so a closed tab does not lose it (for up to 30 days).

## Engines and cost

**Engine.** The service that draws the picture: Codex CLI on your paid ChatGPT plan (the default), or
OpenRouter, Replicate or fal with your own key. Scenri composes the prompt and chooses the reference
images; the engine draws.

**Cost ledger.** Scenri records what each run cost on engines you pay per image, so a shot shows its
cost and Create can sort by Highest cost. Codex runs are recorded at no cost, because OpenAI meters
them against your plan. Settings, Usage counts your runs over the year.

**Spend caps.** A monthly cap per paid engine, set in Settings, Providers. Generation stops before a
cap is crossed. Caps do not apply to Codex CLI, whose usage OpenAI meters, not Scenri.
