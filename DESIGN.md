---
name: Scenri
description: The open studio for brand-consistent AI visuals: dark, imagery-first, quiet chrome
colors:
  bg: "#0d0d0d"
  panel: "#141414"
  raised: "#1a1a1a"
  well: "#0a0a0a"
  fg: "#f5f5f5"
  fg2: "#9a9a9a"
  fg3: "#6b6b6b"
  line: "#262626"
  line-strong: "#383838"
  inv-bg: "#f5f5f5"
  inv-fg: "#0d0d0d"
  gold: "#f5c518"
  gold-ink: "#191300"
  red: "#ff6b62"
  green: "#4ade80"
typography:
  display:
    fontFamily: "Inter Tight Variable, Inter Variable, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  accent:
    fontFamily: "Playfair Display, serif"
    fontStyle: "italic"
  body:
    fontFamily: "Inter Tight Variable, Inter Variable, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Tight Variable, Inter Variable, -apple-system, Segoe UI, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
  mono:
    fontFamily: "ui-monospace, SF Mono, monospace"
rounded:
  xs: "3px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  full: "999px"
spacing:
  gutter: "24px"
  gutter-mobile: "14px"
components:
  button-primary:
    backgroundColor: "{colors.inv-bg}"
    textColor: "{colors.inv-fg}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "34px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "34px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.fg2}"
    rounded: "{rounded.full}"
    padding: "5px 12px"
  chip-active:
    backgroundColor: "{colors.inv-bg}"
    textColor: "{colors.inv-fg}"
    rounded: "{rounded.full}"
    padding: "5px 12px"
---

# Design System: Scenri

## 1. Overview

**Creative North Star: "Scenri UI"**

Scenri is a working instrument for people doing brand-consistent AI product photography, not a marketing surface. Dark by default, near-black ground and near-white ink, so the product photography (the actual content) reads as the brightest, highest-contrast thing on any screen. Chrome (nav, filters, section headers, buttons) stays quiet: hairline borders, flat surfaces, restrained type. The system carries exactly one accent color, gold (`#f5c518`), and it is rationed hard: credits, the keeper star, and in-flight shimmer only. Nowhere else. A single serif italic voice (Playfair Display) appears at most once per screen, on a headline, never competing with the working sans.

This system explicitly rejects the generic-SaaS-dashboard reflex: no identical icon+heading+text card grids, no gradient-text emphasis, no hero-metric tiles, no tiny uppercase tracked eyebrows stacked above every section, no cream/beige "AI-default" palette, no colored side-stripe borders as a decoration. It is not shy of hierarchy, but the hierarchy comes from spacing, weight, and restraint, not from ornament.

**Key Characteristics:**
- Dark ground, near-white ink, imagery does the color
- One accent (gold), rationed to credits / keeper / shimmer
- Flat surfaces at rest, hairline dividers, shadows reserved for anything that floats above the page
- Pills for interactive controls (buttons, chips, tabs): full radius, not rounded-rect
- One serif italic phrase per screen, headings only

## 2. Colors

Near-monochrome dark ground with a single rationed accent; imagery supplies the rest of the color on any given screen.

### Primary
- **Signal Gold** (`#f5c518`): the one accent. Used only for credits pill, keeper star, and in-flight generation shimmer. Never a UI-chrome default (buttons, active tabs, links, focus rings all stay monochrome). Its rarity is what makes it legible as "this matters."

### Neutral
- **Void** (`#0d0d0d` dark / `#ffffff` light): page background.
- **Panel** (`#141414` dark / `#ffffff` light): raised surface background (dialogs, cards' immediate container).
- **Raised** (`#1a1a1a` dark / `#f6f6f6` light): one step up from panel: active/on-state chrome fill (e.g. `data-on` icon buttons).
- **Ink** (`#f5f5f5` dark / `#0a0a0a` light): primary text, and the inverse-fill used by primary buttons and active chips/tabs.
- **Ink Muted** (`#9a9a9a` dark / `#666666` light): secondary text: subtitles, counts, helper copy.
- **Ink Faint** (`#6b6b6b` dark / `#9a9a9a` light): tertiary text: placeholder-weight, deep-muted labels.
- **Hairline** (`#262626` dark / `#e8e8e8` light): default border/divider.
- **Hairline Strong** (`#383838` dark / `#d4d4d4` light): hover/emphasis border state.

### Named Rules
**The One Accent Rule.** Gold appears in exactly three places: the credits pill, the keeper star, and in-flight shimmer. If a new element reaches for gold to look "on brand," that's the tell it should reach for ink/inverse-fill instead.

**The Imagery-Does-The-Color Rule.** Product and scene photography is the only place saturated, varied color is allowed to run free. Chrome stays monochrome so it never competes with the work being art-directed.

## 3. Typography

**Display Font:** Inter Tight Variable (with Inter Variable, -apple-system, Segoe UI, sans-serif fallback)
**Body Font:** Inter Tight Variable (same stack, one working sans, weight does the differentiating)
**Accent Font:** Playfair Display, italic only

**Character:** A precise, geometric-leaning working sans carries every screen; Playfair Display italic is a single accent voice, not a second typeface competing for attention. It shows up on one headline per screen at most, never in UI chrome, labels, or body copy.

### Hierarchy
- **Title** (600, 15px, -0.01em tracking): section headers (`.sc-sec-title`): "Products," "Palette," "Scenes."
- **Body** (400, 13px): default UI copy, descriptions, list content.
- **Label** (500, 12.5px): chips, tab counts, small metadata.
- **Mono**: technical/numeric readouts (briefs, costs) where fixed-width matters.

### Named Rules
**The One-Serif-Phrase Rule.** Playfair Display italic appears at most once per screen, on a heading. It is a punctuation mark, not a voice the interface speaks in.

**The Measure & Wrap Rule.** Display copy uses three shared measure tokens: `--sc-measure-title` (22ch), `--sc-measure-lede` (48ch), `--sc-measure-prose` (62ch), wired through surface selectors in the `styles/foundations/`, `styles/components/` and `styles/surfaces/` sheets (import order set by the `styles/app.css` manifest). Titles (`greet`, lookpage h1, empty h3, bandhead) get `text-wrap: balance`; ledes, empty body, lookpage notes/facts, and settings blurbs get `text-wrap: pretty`. Never apply balance/pretty or measure caps to chips, tabs, buttons, filter labels, truncated one-liners, or composer prose. Utility classes `.sc-text-title` / `.sc-text-lede` / `.sc-text-prose` exist for one-off display copy without a dedicated surface class. On narrow viewports, title measure softens to ~26ch; lede/prose stay in `ch`.

## 4. Elevation

Flat by default. Surfaces sit at the same visual plane with a 1px hairline border doing all the separation work at rest: no ambient shadow on cards, panels, or section chrome. Shadows exist as a strict three-step scale and are reserved for things that are genuinely above the page: dialogs, overlays, the floating composer dock. Shadow presence itself is the signal "this floats," so using it decoratively on a resting card would blunt that signal everywhere else.

### Shadow Vocabulary
- **shadow-1** (`0 1px 3px rgba(0,0,0,.4)` dark / `rgba(0,0,0,.07)` light): the lightest lift: hover state on an otherwise-flat control.
- **shadow-2** (`0 10px 30px rgba(0,0,0,.28)` dark / `rgba(0,0,0,.12)` light): floating dock, popovers.
- **shadow-3** (`0 18px 50px rgba(0,0,0,.34)` dark / `rgba(0,0,0,.18)` light): dialogs, full overlays.

### Named Rules
**The Flat-By-Default Rule.** Nothing gets a resting shadow. If it isn't floating above the page (dialog, overlay, dock), it gets a hairline border and nothing else. The hairline is 1px, with one exception in width: the picture tiles in the Create assets rail wear a 1.5px frame, because a 1px line vanishes against a photograph.

## 5. Components

### Buttons
- **Shape:** full pill (`border-radius: 999px`), 34px height, 16px horizontal padding, 8px icon-to-label gap.
- **Primary:** inverse fill, ink background, page-background text (`--sc-inv-bg` / `--sc-inv-fg`). Hover: 0.88 opacity, no color shift.
- **Ghost:** transparent fill, ink text, hairline border. Hover: raised background + stronger hairline.
- **Danger:** transparent fill, red text and hover border, otherwise identical to ghost.
- **Pressed:** paint only. Ghost and danger take `--sc-press` as a fill; primary steps its opacity to 0.75. No movement of any kind.
- **Focus:** 2px solid outline in `--sc-focus` (one full step below ink), 2px offset. No glow, no color change.
- **Icon-only controls (`.sc-icon-btn`) say their name in a tooltip,** on hover and on keyboard focus, through `layout/Tip.tsx` (the Radix tooltip in the `.sc-tip` coat). The words are the `aria-label`'s words; never a native `title` beside it, which is the same sentence twice on two clocks. A control with a visible label gets no tooltip. A **preview card** (the chip peek, `composer/ChipPreview.tsx`) is the one floating card that wears a tail: it sits a preview gap away from the chip or tile it is about, among a row of chips or a column of tiles, and the tail on the edge that faces its anchor is what says whose it is. Tooltips and menus stay tail-less. A toggle that is on wears `data-on` and says so with `aria-pressed`; a request in flight holds `data-busy` (the cursor says so, the control does not dim); a verb that opens a dialog says `aria-haspopup="dialog"`; a verb with nowhere to go is `disabled` and dims. For a moment after a verb lands the tooltip may say the result ("Copied"), held open, so nothing else has to appear.

### Chips / Tabs
- **Style:** transparent fill, hairline border, muted text (`--sc-fg2`), full pill radius, 5px/12px padding, 12.5px/500 label type.
- **Active state:** inverse fill (same ink-on-bg treatment as primary buttons). Never gold, and never a weight bump: a chip is laid out by its own text, so 500 to 600 moves every chip after it. Active state is a monochrome inversion, not a color change.
- **Category tab row (`.sc-verticals`) is the exception to the pill shape:** flat text-in-a-row with an underline for the active state, not a chip. Both patterns exist in the system; don't cross them: a tab strip stays underline-style, a filter/chip cluster stays pill-style.

### Cards / Containers
- **Corner style:** 14px radius (`--sc-radius-lg`).
- **Background:** panel color, no shadow at rest.
- **Border:** none by default; the grid gap (14px) does the separation.
- **Internal padding:** image fills the card at a fixed 4:5 aspect ratio; caption/label sits below in a fixed-height footer.

### Shot tiles (the Create feed)

A catalog card shows a thing you might use; a shot tile shows work you just made, and the picture
is the whole point. So the tile follows one rule of its own: **at rest the card wears marks, on
hover the marks become controls.**

- **A mark is state you can only learn from the tile**: a kept shot (gold star), a stacked run (a
  `Stack` glyph and a bare numeral), a selected outline, in-flight shimmer. Marks carry no pill and
  no border, and they carry their own contrast: a 1px hard shadow halo plus a soft lift, because
  this app generates white products on white seamless on purpose.
- **A control is a thing you do**, and it waits: select, keep, archive, refine. They arrive together
  with one bottom-anchored scrim on `:hover`, on `:focus-within` and on any device without hover.
  The same element can be both, and the star is the worked example: bare gold glyph at rest, gold
  glyph in a scrim puck under the pointer.
- **One skin, `.sc-cell-ctl`**, geometry and skin only, the way `.sc-cardpuck` is for catalog cards.
  28px minimum (32 on touch), full-pill radius, `--sc-scrim` fill and `--sc-scrim-fg` ink, no
  border. Chrome over a photograph uses the scrim tokens, never `--sc-glass`: glass follows the
  theme and turns white-over-photograph in light mode.
- **One scrim per card edge, never one blurred pill per control.** Eight `backdrop-filter` layers
  per tile is eight compositor surfaces in a feed of hundreds, buying what one eased gradient
  already buys. The gradient is eased across thirteen stops, not two: a black-to-transparent linear
  reads as a grey haze with a visible band across the picture.
- **One ring, one weight, one ink.** Every reason a tile is singled out (the shot the composer
  acts on, a shot picked into a batch) draws the same 2px inverse-fill ring inside the tile's edge.
  Two rings a few pixels and a few percent grey apart are a second vocabulary for one idea, *this
  tile and not the others*, and side by side they read as a rendering bug. What tells the states
  apart is the tick in the corner, which is present, filled and countable.
- **No tile is ringed by default.** A ring is drawn for a shot someone chose. The feed's `selected`
  memo falls back to the newest shot so the keyboard shortcuts always have a target, and passing
  that fallback to the tiles put a permanent border on an untouched feed that nothing could clear.
  Pass the raw id.
- **The tile carries two verbs and no more.** Refine, which is the loop this app exists for, and
  one overflow that opens the shot's menu. Keep and Archive were buttons of their own once, which
  put four separate things over a photograph on every hover and gave the tile under the cursor a
  different number of them than its neighbours. Management belongs in the menu; the picture keeps
  its corners. The menu's items are built once (`canvas/shotMenu.ts`) and rendered by both the
  right-click menu and the overflow, because Radix gives those two different component families and
  a hand-written second copy drifts within a release.
- **A mark is never a button.** The keeper star is gold when kept and absent when not; it does not
  hover, take a puck, or take clicks. Keeping is a line in the menu like every other verb. It used
  to be a control that appeared in scrim ink and turned gold when on, which gave the one accent in
  the system two jobs: "there is a star here" and "this is kept".
- **Hovering a tile shows the same three controls, always.** The tick, Refine and one overflow, in
  every situation: nothing picked, a batch half built, a batch just emptied. There is no selection
  mode for chrome, no just-cleared mode, and no switch. Three separate mechanisms for those states
  were built and deleted; each one fixed the case it was written for and made another one stranger,
  because a tile that can look four ways for reasons nobody can see is worse than a tile that
  always looks one way for a reason everybody can. The pointer is on it. That is the whole rule.
- **While a batch is being built the tile shows its tick and nothing else.** Refine and the
  overflow both act on one picture, and choosing which twelve go in a set is the opposite of that;
  the menu drops `Refine from this` at the same moment, because two surfaces offering one verb must
  agree about when it applies. The scrim goes with them: a scrim exists to make a rail legible, and
  with no rail it darkens the photograph to protect nothing. What a hover has to say there is only
  "the pointer is on this one", so it says it with a ring and leaves the picture alone. Nothing
  becomes unreachable: right-click opens the same menu on any tile, at any time.
- **Selection changes two things and no more:** what a tap means, and what the tile carries.
- **A verb that does not apply is absent, not disabled and not hidden by a stylesheet.** Rendering
  it and then fighting its opacity is what produced three competing mode mechanisms; leaving it out
  of the tree gives the hover rules nothing to argue with.
- **Blank ground clears.** Clicking the feed where there is no tile empties the picks and drops the
  ring, the pointer's version of the Escape that already does it.
- **Facts about a shot belong to the shot's record, not to its tile.** Provenance, version count and
  filing live in the detail overlay, which has the room to name them; a tile that states four facts
  in chips it never hides is a tile that is never just the picture.

### Shot review (the overlay)
- **Two axes, one tile.** The rail down the left is the feed you came from, every shot the grid holds in the grid's own order, originals and refinements alike. The strip under the picture is that shot's own history, the root first and every version made from it after. Both wear the strip's `.sc-thumb` tile and ring the shot on screen with the feed's own ring, the inverse fill, while every other tile stands back at 0.55 opacity and comes forward under the pointer. Orientation and position say which axis is which: the rail carries no words, the trail carries one line. Neither is ever "variations".
- **The history is a trail, read left to right.** One box as wide as the picture: a line at its left edge saying where you are (`Original`, `Refinement 4 of 6`), and under it the square tiles, the original set apart from what was made of it by a hairline. No numeral under any tile, no caption over the row, no arrows between tiles, no tree. The ring says where you are, the line says which and how many, the hairline says where it began. Side by side, the panel's title is the record's name (`Shot`, `Refinement 3`); stacked (under 1024), the title sits right under the trail and carries the line itself, the trail draws none, and on a phone the trail runs edge to edge with the gutter as its padding, the way a scrubber does. Refining from an earlier step makes a branch in the record and the row stays one row, chronological; the step names its source on its card (`From Refinement 1`) only when that is not the tile before it. Hovering or focusing a tile peeks it at a readable size with its name and what that step asked for, the sentence that was typed, never a description read off the picture; a record without one shows the name alone. The step on the stage is always in the row, as a shimmer tile while it renders and the warning tile after it fails; any other step without a picture stays out. Left and right inside a focused trail move focus along it and stop there, the rail's own rule stood on its side. The words on this surface are Original, Refinement and history; never version, lineage, node, parent or branch.
- **The rail is furniture only where there is room:** from 1280px, the width the assets drawer needs to dock, and never below two shots. Below that width the arrows carry the walk, and a phone swipes the picture.
- **One walk.** The header arrows, the left and right keys and a swipe on a phone all step the same feed order; up and down step the history. Hovering an arrow peeks the shot it would step to, in the chip peek card. Hovering a rail tile peeks it beside the tile, level with its top. Scrolling the rail or the strip never selects, and neither does the wheel: over the picture the wheel is a zoom.
- **The stage never animates geometry.** A change of picture or of place lands whole in one commit; the only motion on the stage is a cross-fade of pixels (the picture before stays under the next until it has painted, then the next fades in). Nothing on the stage carries a transform transition and nothing toggles a clip against an easing property: a transform that eases is rasterised blurry and snapped sharp at the end, a clip that drops while it eases spills the picture, and a scaled compositor layer checkerboards for a frame on a large picture. All three read as flicker, and the rule holds for whatever the stage grows next. There is no zoom: an engine's output is about 1.5 MP, which a 2x display already shows pixel for pixel at fit, so a close look could only enlarge pixels and make the work read as blurry. More detail is more pixels, an upscale, not a magnifier.
- **The picture answers a right click.** A right click or a long press on it opens the shot's own verbs, the ones the header carries, the way a tile in the feed does; the browser's menu never shows over a shot.

### Inputs / Fields
- **Style:** hairline border, panel background, `--sc-radius` (10px) corners.
- **Focus:** border shifts to `--sc-focus` (ink), no glow/ring beyond the border itself, consistent with the no-decoration-at-rest posture.

### Composer insert menus (`/`, `@`, `#`)
A caret (or phone-docked) shortlist, not a command palette. The four triggers share one shell (`.sc-cmd`, `--sc-z-popover`) and one ranking rule (`pickList` / `insertShortlist`). `$` is products, `@` is presenters, `/` is scenes and `#` is colours. Each menu carries that label at the top. Typing in the brief is the filter: no inner search field, no cap banner, no keyboard-hint footer. Empty query is a ranked shortlist; a typed miss stays open with one quiet line. Colors, marks and shots stay on the attach panel. Structured chips and `compileBrief` IDs do not change.

### Composer chips in the sentence
A chip is an inline atom in real text flow that owns its gap as a symmetric 2px margin: two chips that touch in the document sit 4px apart, and the same holds in a right-to-left line. The line keeps no space on a chip's behalf, ever: the spaces beside a chip are the user's, typed or not, the way a mention behaves in any text field. Where the user has typed nothing beside a chip the line keeps a guard there, one zero-width character (`\uFEFF`) that gives the caret text to sit in, because a phone shows no caret anywhere else; the guard is never part of the sentence (readers strip it, the unit maths does not count it, typing into it leaves only what was typed), and between two touching chips the browser draws the caret at the guard, which is where the two margins meet. A chip is one unit to the keyboard: one press crosses it, the key that faces it removes it (keydown for a hardware key, `beforeinput` for a phone's keyboard, since no engine deletes an atom consistently on its own), and a press at a line edge with nothing on its side is swallowed. On touch the platform's caret and word-snap stand, and a tap is corrected only in the line's padding. `composer/line/invariants.ts` keeps the guards and the browser's untidiness straight; `composer/line/keys.ts` holds the key rules; `render.ts` drops the seams older briefs stored.

### Section Headers (`.sc-sec-head`)
- Flex row, title (15px/600) at the leading edge, an optional right-aligned action (ghost button, "+ Add X" pattern) at the trailing edge. **This is strictly a 2-slot contract**: title-group and trailing-action. A subtitle, when present, belongs inside the title group (its own inline flex with an explicit gap), never as a third top-level flex child, which is what produces glued text.

### Library Pages
The shared shell behind every curated-asset browsing surface (Products, Scenes, Presenters: "what / who / where"): one sticky row (`.sc-filterbar`): a facet's inline tabs at the leading edge, a result summary + Clear only while a filter/search is active, search, and a primary action, pinned right. No separate title/description band above it: the nav bar already names the active page, and a second header repeating it was tried and reverted: it reintroduced the two-thin-rows dead space this pattern exists to solve.
- **The facet control is always real, inline tabs, never a popover.** One rule (`facetMode` in `libraryRules.ts`) decides only whether there's anything to select between (`<2` values → hidden); 2+ always renders as tabs, regardless of count: a long list scrolls horizontally rather than hiding behind a click. One consistent visible pattern across every page beats a "smarter" per-page treatment that looks different page to page.
- **Search shows once a library clears ~8 items**, and may match more than the card displays (a Presenter card shows name + descriptor; its search also reads hair, skin, build, age): the search system is allowed to be smarter than the visible card.
- **A primary CTA slot may be visible before it's wired.** A not-yet-wired action renders as a ghost button: its presence signals intent even before it does something, and ghost is the tell that it is not the loud, working action yet.

### Create dialogs (product / presenter / scene)
A create dialog is a picture being named, not a settings panel. Empty: one large drop well. Filled: a 4:5 grid of references. Name and notes are labeled `.sc-in` fields, the same control as Settings, not a second input style. Filing is optional chips under a quiet legend. The chooser is one press; the forms do not grow a second step.

## 6. Do's and Don'ts

### Do:
- **Do** keep gold to credits / keeper star / shimmer only, nowhere else, including active filter/tab states.
- **Do** use a hairline border as the default separator; reach for a shadow only when something is meant to read as floating above the page.
- **Do** treat `.sc-sec-head` as a 2-slot contract (title-group, trailing action); nest a subtitle inside the title group with its own explicit gap, never as a sibling flex item.
- **Do** keep every interactive control (button, chip, tab, input) on the existing radius/height scale: 34px controls, full-pill chips/buttons, 10px field radius.
- **Do** let product/scene photography carry the color on any screen; keep surrounding chrome monochrome.
- **Do** keep chrome that sits over a photograph on `--sc-scrim` / `--sc-scrim-fg`, and give a
  bare mark its own shadow halo. Those two tokens are theme-neutral precisely because what they
  have to stay legible against is the picture, not the page.
- **Do** reach for the shared active inversion (`--sc-inv-bg`/`--sc-inv-fg`) for any new on/off control: the scene card's bookmark toggle is the worked example. Gold is not an on-state; it belongs to the keeper star, and one colour cannot carry two meanings.
- **Do** give every new focusable control the system's one focus treatment: `outline: 2px solid var(--sc-focus); outline-offset: 2px`, by adding its selector to the shared list in `styles/foundations/interaction.css` (spell the geometry `var(--sc-ring-w)` / `var(--sc-ring-off)`, the tokens are authoritative), and give fields the same ring via `:focus-within` (`.sc-swap-search`, `.sc-assets-search`). The only sanctioned variation is `outline-offset: 1px` where a control sits in a tight grid or inside another control's border and 2px would collide or spill.

- **Do** keep every state change paint-only: pressed controls never change geometry. Feedback is fill, opacity, border colour or inset shading, never `transform`, padding, border-width or size, so nothing moves under the cursor and a click that lands on an edge stays landed. The shared press list lives in `styles/foundations/interaction.css` alongside the focus list; a selected state follows the same rule, which is why neither chips nor settings rows bump their font-weight. If you scope a hover (`.sc-topbar .sc-icon-btn:hover`), spell it `:hover:not(:active)`, because a scoped hover out-ranks the shared press fill and the control will otherwise hold its hover tone through the press, registering nothing.

### Don't:
- **Don't** use gradient text, hero-metric tiles, or identical icon+heading+text card grids, the generic-SaaS-dashboard pattern this system explicitly rejects.
- **Don't** use a colored side-stripe border (`border-left`/`border-right` as an accent) anywhere.
- **Don't** add a tiny uppercase tracked eyebrow above a section as default scaffolding.
- **Don't** apply gold to a UI-chrome default state (active tab, focus ring, link color, button fill). That is the rationing rule breaking.
- **Don't** give a resting card, panel, or section header a shadow "for depth". Flat + hairline is the rest state; shadow means floating.
- **Don't** stack a subtitle, a header title, and a trailing action as three siblings in `.sc-sec-head` with no gap. It produces glued text; wrap title+subtitle together instead.
- **Don't** put a "Create new" tile as the first item in a catalog/library grid. It disrupts a visual-comparison surface, shifts scan position on every return visit, and duplicates the header's own primary CTA, evaluated and rejected for the Creative Library pattern, not merely unconsidered.
- **Do** let a dialog surface hold focus silently. Every dialog pairs `onOpenAutoFocus={focusSelfOnOpen}` (`app/dialogs.ts`) with the one shared `.rt-BaseDialogContent:focus` → `outline: none` rule in `styles/foundations/interaction.css`. Without the JS half Radix aims at the close button and the dialog opens wearing a ring around its ×; without the CSS half the ring simply moves onto the surface. Neither half is optional, and neither is written per dialog.
- **Don't** invent a per-component focus or active treatment: a `border-color` swap, a box-shadow halo, a background change. It reads as a second vocabulary for a state the user already knows, and the two drift apart the moment either is touched; add to the shared list in `styles/foundations/interaction.css` instead.
- **Don't** style an unwired CTA as primary (inverse-fill). Ghost is the tell that it's not the real, working action yet.

### Writing

Product copy is part of the design system. The voice is plain, factual and specific: say what
happened and what to do next, in the words the interface already uses. Contractions are fine.
Sentences are short.

- **Talk about the work, not the technology.** A shot rendered, a brief was kept, a key was
  refused. Never AI magic, never marvel at the model.
- **No decorative emoji and no AI-flavored symbols** (sparkles, rockets, robots) in product or
  public copy. Phosphor icons carry the iconography.
- **No em or en dashes in authored copy.** Use a period, comma, colon, semicolon or parentheses,
  whichever the sentence actually wants. Prompt text sent to an engine is exempt: changing a
  prompt changes generated pixels.
- **The product is Scenri; `scenri` is an identifier.** Capitalised in every sentence a person
  reads: docs, UI copy, CLI output, comments, release notes. Lowercase only where a machine reads
  it and changing it changes behaviour: the npm package and its subcommands, `@scenri/*`,
  `SCENRI_*`, `~/.scenri`, `scenri.co`, `scenri:*` keys, filenames, tags and URLs. There is no
  third case. The app's formal name is Scenri Studio; the product is Scenri, and tab titles use
  the short form because tab strips are tight. See §7.
- **Avoid exclamation marks.** The work is the excitement.
- **Prefer specific action labels.** "Export .brand", "Delete shots", "Add key". Never "Submit"
  or "OK".
- **Technical terms stay technical.** HTTP 401 is HTTP 401; naming it precisely is the courtesy.
- `packages/cli/test/copyHygiene.test.ts` guards the public markdown surface and, for the name rule
  above, `apps/studio/src` and `packages/*/src` as well; `.githooks/pre-commit` runs the same check
  on staged lines. The release-notes validator in `packages/cli/src/release/notes.data.ts` guards
  What's New copy.

## 7. The mark

The name is **Scenri**, spelled the way §6 requires; the wordmark draws it in caps.

The artwork of record is `apps/studio/brand/scenri-lockup.svg` and `scenri-symbol.svg`. The same
geometry is inlined in `layout/ScenriMark.tsx` so the mark cannot arrive after the bar it sits in;
`test/scenriMark.test.ts` fails if the two drift. Every icon Scenri ships is rendered from those two
files by `scripts/brand-icons.mjs`, and the outputs are checked in.

- **The mark is `currentColor`, never a light and dark pair.** `.sc-wordmark` sets
  `color: var(--sc-fg)` and the ink follows the theme for free. A pair is two files to keep in step,
  a variant to get backwards, and a flash while the theme resolves.
- **The Figma suffixes name ink, not theme.** `scenri-logo-light` is the *white* cut and belongs on a
  dark background. Wiring those names onto `[data-theme]` gives white on white.
- **Twenty pixels tall in the 52px bar**, which renders 79 wide at the lockup's 3.947:1. Below 767px
  the symbol replaces the lockup, by CSS and not by measuring the viewport in JS, because the swap
  must not flash on mount.
- **One tile for the rasters**: the mark in white on `#0d0d0d`, the app's own dark background. It
  reads against light and dark browser chrome alike, and iOS composites black under transparency, so
  the home screen clip has to be opaque regardless. `favicon.svg` is the single exception and carries
  both inks behind `prefers-color-scheme`, because a tab strip is chrome and follows the OS rather
  than the theme the app is set to.
