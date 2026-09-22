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
**The One Accent Rule.** Gold appears at full strength in exactly three places: the credits pill, the keeper star, and in-flight shimmer. There is one fourth use and it is a wash rather than the colour: **an 11% gold tint over the surface (14% in light) marks the primary create action and nothing else**, which today is Home's main create card and the lead row of the top bar's New menu, the same act in two places. At that strength it reads as "start here" without reading as a state, which is why it never lands on a selected, active or focused thing. If a new element reaches for gold to look "on brand," that's the tell it should reach for ink/inverse-fill instead.

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
**Chrome that is over the page rather than above it** takes shadow-1 for exactly as long as that is true. The top bar is flat with its hairline at the top of a page and lifts once the page has scrolled under it, which is the sentence the scale already speaks: a shadow means this floats. It keeps its height: a shrink, snapped or eased, read as the page lurching under a reader, so the shadow alone says it floats.

**A panel opened from the bar** is one card at `--sc-radius-float` (22px) over shadow-3 with an inset hairline, and it says what it is: a 48px head carrying its name, sticky, on the panel's own fill. The body is inset 8px on three sides and its rows are 14px corners on an even 8px frame, so a painted row sits square inside its fill. One lead column of 48px wherever a row carries a picture, 14px to the text, 20px where a row carries a brand's mark instead. Each panel is as wide as its own rows ask and no wider: brands 340, activity 440, New 352. The brands panel is the one compact panel: its rows are names you scan rather than pictures you read, so they are 36px with a 20px mark on the same 8px frame (44px in a phone's sheet, for a thumb), and it is one list with no labels and no sections: the brand you are in, checked and first, then every other brand A to Z, each once. Past six brands a finder leads and the list scrolls in place, ten rows (four in the sheet) with no scrollbar and no fade, running straight into the hairline under it with no band between, so the panel is one height at seven brands or seven hundred and Settings and the way out never move. A query searches every brand. A brand's circle draws its square icon, or its logo only when a circle can hold it, and its initial otherwise. Below 768px the same panel is the studio's bottom sheet, full width, with the drag grip that every other sheet wears.

**The Flat-By-Default Rule.** Nothing gets a resting shadow. If it isn't floating above the page (dialog, overlay, dock), it gets a hairline border and nothing else. The hairline is 1px, with one exception in width: the picture tiles in the Create assets rail wear a 1.5px frame, because a 1px line vanishes against a photograph.

## 5. Components

### Buttons
- **Shape:** full pill (`border-radius: 999px`), 34px height, 16px horizontal padding, 8px icon-to-label gap.
- **Primary:** inverse fill, ink background, page-background text (`--sc-inv-bg` / `--sc-inv-fg`). Hover: 0.88 opacity, no color shift.
- **Ghost:** transparent fill, ink text, hairline border. Hover: raised background + stronger hairline.
- **Danger:** transparent fill, red text and hover border, otherwise identical to ghost.
- **Pressed:** paint only. Ghost and danger take `--sc-press` as a fill; primary steps its opacity to 0.75. No movement of any kind.
- **Focus:** 2px solid outline in `--sc-focus` (one full step below ink), 2px offset. No glow, no color change. It answers the keyboard: after a click or a tap, a control that receives focus, including focus a menu or dialog hands back to its trigger as it closes, wears no ring and opens no tooltip (see the focus rule under Do).
- **Split:** one primary control with two hit regions, for a verb that has a usual thing and a short list of neighbours (the top bar's New). The filled half performs the usual thing: the plus in the fill's own ink, 12px in from the round end, then the word at 13.5/500, one mark and one word the way the primary reads (it once rode a disc of the opposite ink, a third shape inside the loudest control in the bar); a 1px divider in the fill's own ink at 22%; the caret half opens the menu. Its shape is the primary's full round, so each end is a half-circle at any height, and each half carries that curve on its own end so a focus ring follows the shape. Its press is the one sanctioned exception to the primary's opacity step: a shade of the fill (10% hover, 18% pressed, of `--sc-inv-fg` over `--sc-inv-bg`) that covers the whole control over the plus and the word, since the whole control is that act, and only the caret's own half over the caret, since that press opens the menu instead. An opacity step cannot say which of the two a press will be, and saying that is the control's whole purpose. Never for a verb with no usual thing: that is a menu wearing a loud coat.
- **Icon-only controls (`.sc-icon-btn`) say their name in a tooltip,** on hover and on keyboard focus, through `layout/Tip.tsx` (the Radix tooltip in the `.sc-tip` coat). The words are the `aria-label`'s words; never a native `title` beside it, which is the same sentence twice on two clocks. A control with a visible label gets no tooltip. Two floating cards wear a tail, because each is about one thing among many: a **preview card** (the chip peek, `composer/ChipPreview.tsx`) sits a preview gap away from the chip or tile it is about, and a **coach card** points at the control or the tile its step is about; the tail on the edge that faces the anchor is what says whose it is, and both share one tail rule. Tooltips and menus stay tail-less. A toggle that is on wears `data-on` and says so with `aria-pressed`; a request in flight holds `data-busy` (the cursor says so, the control does not dim); a verb that opens a dialog says `aria-haspopup="dialog"`; a verb with nowhere to go is `disabled` and dims. For a moment after a verb lands the tooltip may say the result ("Copied"), held open, so nothing else has to appear.

### Transient alerts (toasts)
A toast is **what just happened**, in the bottom-left, then gone. It is never how the product becomes correct: if the stack failed to render, every mutation still stands. Activity (the bell) is the other lifetime: work in flight, and what finished while you were elsewhere. A toast never writes Activity. Activity may toast on settle, and already stays quiet when you are watching the feed or have the panel open.

**When to use.** Something important happened outside the thing you are looking at, or it failed, or there is a short way back (Undo). **When not to.** The interface already says it (a card appeared, a title changed, a tooltip held "Copied", a tile shimmered). High-frequency chrome (keeper, bookmark, selection, category) never toasts.

**Four kinds, and no more.** `info` (a state change, no colour), `success` (it completed and the screen does not already say so), `warning` (it worked, with something worth knowing), `error` (it failed: the only colour, a red mark, stays until dismissed). No green boxes. Gold is not a success colour.

**Timing.** Ephemeral cards leave on a length-scaled timer (about four seconds, capped at eight; longer when they carry an action). Errors stay. The clock pauses under the pointer, under keyboard focus, and while the tab is hidden. One stack, three cards, newest at the edge; identical actionless events share a card (`×N`) rather than stacking. Distinct errors never merge. An error or an Undo is never dropped to make room while anything else could go; a stack of nothing but errors and Undos gives up its oldest Undo first, then its oldest error.

**Shape.** Compact note, 280px min / 356px max: 16px Phosphor mark (none on info, check / warning / warning-circle on the rest; red only on error), body title (`--sc-text-body`), caption detail (`--sc-text-caption`) wrapped to two lines, the action under the copy in the same quiet treatment as the update float's Later, a 28px close in the top-right. Card radius, panel, hairline, shadow-2. A short title still sits in a real note, not a stub. One action, two at most. Motion is a short fade and rise; reduced motion keeps the fade and drops the travel. Desktop sits bottom-left, 16px from the edge, and a gap above the update float when one is up. A phone is full width above the tab bar, lifted by `--sc-bottom-inset` so a keyboard never covers it. Where a composer is docked (Home and Create at every width; the open shot and the presenter studio on a phone) the stack stands above the dock, never over its buttons: the dock publishes its height (`useDockHeight`) and the rule repeats the dock's own offset. The stack is drawn on the body, outside the app's root layer (a card drawn inside it sat under the tutor's curtain and every dialog, seen but never pressed): z-index 100 puts it above dialogs, sheets, menus and the curtain, the update float is lifted clear of it and the update overlay stays above. A press on a card is the card's own: it never closes the dialog, popover or picker beneath it, and a pointer press never takes the focus from a dialog. Never steal focus. Polite live region for info, success and warning; an assertive one for errors, with no `role="alert"` (an empty alert on every page reads as a failure).

### Chips / Tabs
- **Style:** transparent fill, hairline border, muted text (`--sc-fg2`), full pill radius, 5px/12px padding, 12.5px/500 label type.
- **Active state:** inverse fill (same ink-on-bg treatment as primary buttons). Never gold, and never a weight bump: a chip is laid out by its own text, so 500 to 600 moves every chip after it. Active state is a monochrome inversion, not a color change.
- **A row of destinations is a tab strip, not a chip cluster.** The top bar's five places state the current one with a 2px underline sitting on the bar's own bottom hairline (`bottom: -1px`), grown with `scaleX` rather than faded in, so the active state costs the row no height and there is one line on screen rather than two. No fill, no weight bump.
- **The bar's end is three groups, told apart by space alone:** the quiet tools (Learn, Help below 1024px, the bell) 2px apart, then New, then the brand, 16px on either side of New. One icon among the tools, one fill in the row, one mark at its end: a second icon or a second fill there reads as a second primary.
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
- **The selection bar is a toolbar, at one scale.** A chip saying how many, `Select all`
  as the one word (it toggles to `Deselect all`), the verbs as icon tools that name
  themselves in a `Tip`, and the way out behind a hairline. A pointer gets a 40px bar with
  32px tools; a phone gets 42 and 34, with the same 17px glyph and the same 12.5px word, so
  nothing looks bigger, only easier to hit. It fits its contents at every width rather than
  stretching to the gutters, because a bar that fills the screen is a panel. Loudest first:
  the verbs, then the way out, then the count, then `Select all`. The count is a chip and
  never a filled disc, since the one thing you cannot act on must not be the brightest mark
  in the bar. The verb that removes shots from the feed answers in red under the hand.
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
- **The history is a trail, read left to right.** One group as wide as its tiles, centred under the picture and never wider than the stage (sized by what it holds, never by the picture, so a version of another shape does not resize the row): a line at its left edge saying where you are (`Original`, `Refinement 4 of 6`), and under it the square tiles, the original set apart from what was made of it by a hairline. No numeral under any tile, no caption over the row, no arrows between tiles, no tree. The ring says where you are, the line says which and how many, the hairline says where it began. Side by side, the panel's title is the record's name (`Shot`, `Refinement 3`); stacked (under 1024), the title sits right under the trail and carries the line itself, the trail draws none, and on a phone the trail runs edge to edge with the gutter as its padding, the way a scrubber does. Refining from an earlier step makes a branch in the record and the row stays one row, chronological; the step names its source on its card (`From Refinement 1`) only when that is not the tile before it. Hovering or focusing a tile peeks it at a readable size with its name and what that step asked for, the sentence that was typed, never a description read off the picture; a record without one shows the name alone. The step on the stage is always in the row, as a shimmer tile while it renders and the warning tile after it fails; any other step without a picture stays out. Left and right inside a focused trail move focus along it and stop there, the rail's own rule stood on its side. The words on this surface are Original, Refinement and history; never version, lineage, node, parent or branch. One read of the tree answers for every shot in it, so stepping along the trail is never a miss and the row never blinks. Hovering an arrow peeks the shot it would step to, and after the step the card follows to the new neighbour.
- **The rail is furniture only where there is room:** from 1280px, the width the assets drawer needs to dock, and never below two shots. Below that width the arrows carry the walk, and a phone swipes the picture. The rail is flat: one size, one gap, never a scale, so the tiles you aim at hold still and the ring is the only thing that says which. An end dissolves only where there is more past it: a fade over the top while shots sit above the view, over the bottom while shots sit below, none at the list's own ends, so the first and the last shot are whole when they are the one on the stage; the fade grows in with the first stretch of travel away from an end rather than popping at the first pixel. The ringed tile is centred on every step, so the column reads outward from the shot on screen. The rail keeps one 14px gutter on every side and nothing sits over it: the close and the arrows stand beside it, the rail's own right gutter being the gap, so the tiles sit 14px from the edge and the close 14px from the tiles, because a control over the first tiles made those tiles unreachable. A dock's magnification was tried and dropped: the largest tile was whatever passed the middle, not the selected one, and it argued with the ring.
- **One walk.** The header arrows, the left and right keys and a swipe on a phone all step the same feed order; up and down step the history. Hovering an arrow peeks the shot it would step to, in the chip peek card. Hovering a rail tile peeks it beside the tile, level with its top. Scrolling the rail or the strip never selects, and neither does the wheel: over the picture the wheel is a zoom.
- **The stage never animates geometry.** A change of picture or of place lands whole in one commit; the only motion on the stage is a cross-fade of pixels (the picture before stays under the next until it has painted, then the next fades in). The box is held too: a shot that recorded its pixels takes its own box before a byte arrives, and one that did not borrows the shape of the last picture painted, so a step never collapses the stage; a different shape lands as one cut in the same commit the picture paints. Nothing on the stage carries a transform transition and nothing toggles a clip against an easing property: a transform that eases is rasterised blurry and snapped sharp at the end, a clip that drops while it eases spills the picture, and a scaled compositor layer checkerboards for a frame on a large picture. All three read as flicker, and the rule holds for whatever the stage grows next. There is no zoom: an engine's output is about 1.5 MP, which a 2x display already shows pixel for pixel at fit, so a close look could only enlarge pixels and make the work read as blurry. More detail is more pixels, an upscale, not a magnifier.
- **The refine field says which picture it is about, then takes only what changes.** Above the field sits the Refining chip, the picture on the stage as a small thumbnail, the one chip pattern the app has (peek on hover, the image on click); it follows every step of the trail, and inside an open shot it has no X, because there is nothing else in there to refine. That chip is the whole statement of "based on this version": what you type is about that picture, and the server borrows its identity. The record under PROMPT is the ask alone. A band of "carried" or "keeping" chips over the field was built and taken out: it read as a second list of the record, and a switch per chip made refining feel like configuration. What the thread is made of is said once, on the Original, one step down the trail. Making a removal ask stop sending the removed identity as a reference is the compiler's job, measured by a battery, not a control.
- **The picture answers a right click.** A right click or a long press on it opens the shot's own verbs, the ones the header carries, the way a tile in the feed does; the browser's menu never shows over a shot. The verbs are Download (one click, the PNG itself), Keep, Copy, Archive and, once archived, Delete. The record's own copy, in the corner of PROMPT, is the same icon control with the same tooltip, busy step and held "Copied"; it puts the sentence on the clipboard with its chips, so pasting into any prompt line gets the chips back. Under the record a live shot offers Try again and Reuse setup, repeat before change: Try again runs the same setup once more; Reuse setup starts a new shot from it in the composer (prompt, chips, shape, count), focused and announced like an example. Changing the picture itself is the refine field's job and carrying its prompt elsewhere is Copy's. A failed shot, with no picture to refine, offers Edit the prompt instead, which puts the prompt back in the composer. There is no Compare: the trail puts the source one click away and the stage cross-fades between the two, which is the before and after.

### Inputs / Fields
- **Style:** hairline border, panel background, `--sc-radius` (10px) corners.
- **Focus:** border shifts to `--sc-focus` (ink), no glow/ring beyond the border itself, consistent with the no-decoration-at-rest posture.

### Composer insert menus (`/`, `@`, `#`)
A caret (or phone-docked) shortlist, not a command palette. The box sits on the caret: a pageable list occupies its reservation, a miss or a filter hugs that same edge. The four triggers share one shell (`.sc-cmd`, `--sc-z-popover`) and one ranking rule (`pickList` / `insertShortlist`). `$` is products, `@` is presenters, `/` is scenes and `#` is colours. Each menu names that catalog and its size on the grey title, the same quiet count the attach panel uses. Typing in the brief after the sigil is the filter: no inner search field, no cap banner, no keyboard-hint footer. Empty query is a ranked shortlist; the rest of that catalog pages in the same shell as you reach the end, with a quiet `N of total` so the cap is never silent; a typed miss stays open with one quiet line. Marks and shots stay on the attach panel. Structured chips and `compileBrief` IDs do not change.

### Composer chips in the sentence
A chip is an inline atom in real text flow that owns its gap as a symmetric 2px margin: two chips that touch in the document sit 4px apart, and the same holds in a right-to-left line. The line keeps no space on a chip's behalf, ever: the spaces beside a chip are the user's, typed or not, the way a mention behaves in any text field. Where the user has typed nothing beside a chip the line keeps a guard there, one zero-width character (`\uFEFF`) that gives the caret text to sit in, because a phone shows no caret anywhere else; the guard is never part of the sentence (readers strip it, the unit maths does not count it, typing into it leaves only what was typed), and between two touching chips the browser draws the caret at the guard, which is where the two margins meet. A chip is one unit to the keyboard: one press crosses it, the key that faces it removes it (keydown for a hardware key, `beforeinput` for a phone's keyboard, since no engine deletes an atom consistently on its own), and a press at a line edge with nothing on its side is swallowed. On touch the platform's caret and word-snap stand, and a tap is corrected only in the line's padding. `composer/line/invariants.ts` keeps the guards and the browser's untidiness straight; `composer/line/keys.ts` holds the key rules; `render.ts` drops the seams older briefs stored.

### Composer attach picker (the "+")
One panel, one grid, one insertion path. The "+" answers "what do you want to add to this shot": a head
that stays put over the one scrolling grid, in a frame that keeps its size whatever the tab. It is anchored
above the composer at its full width on every screen and is non-modal on purpose: its mousedown never takes
the caret (`keepCaret`), so a pick lands where you were typing, the brief stays in view, and the panel stays
open for the next one. A phone gets the same panel with the keyboard dropped on open; a bottom sheet was
tried and covered the very composer the picker adds to.
- **The head is one row, the composer's Figma row.** The category rail leads and takes the slack; trailing,
  the library pages' own search (the 34px square that opens into a field over the rail, so nothing moves),
  the primary **Upload image** pill (the one insertion the grid cannot offer, so it wears the primary fill),
  then the 32px square close. 16px padding over a hairline; 12px gaps rather than the Figma's 16, because
  at 16 the seventh tab sat behind the fade at 1440. Nothing in the head is the panel's own control: search
  is `LibrarySearch`, the buttons are `.sc-btn` and `.sc-icon-btn`.
- **A phone is not the desktop head folded.** A toolbar of a 44px pill and two circles over the rail was
  built and dropped the same hour: it read as a desktop panel squeezed. The phone head is one thumb-high
  row, the rail and the search (open, the field takes the row and the rail steps aside, the library's own
  phone answer); **Upload image is the grid's first tile**, a dashed frame at the size of what it joins,
  the camera roll's idiom; and the composer's own + is the close, turning into an x while the panel is up,
  so no head button doubles it.
- **The category rail is the underline rail** (`VerticalsTabs`), scoped to the panel's scale, never pills:
  a tab strip stays underline-style, and the rail already scrolls sideways with edge fades, which is the
  whole mobile answer. Every grid sits under the same two-slot row: the group's name and count leading,
  one action trailing. On All that action is "Show all"; on a tab it is the tab's own way to make one (Add
  product, Create presenter, Create scene, Add color, Add logo; a shot is made by generating, so Shots has
  none). An action with no title beside it read as a stray, so the title stays even under a rail that has
  just said the name.
- **Every picture is a square in one grid**, sized for the thing (a face and a packshot read at 112 to
  130px) so the count follows the width and never changes between tabs. A presenter is the canonical
  `presenterAvatar`, a product its packshot with the brand under it, a scene its 4:5 preview centred (what
  the chip picker does with it too), a mark letterboxed on white, a colour a swatch chip. One fixed
  caption; "Recommended" is in the title, not the caption. Nothing on a tile manages.
- **A tile's states, every case.** The picture sits in a hairline frame. Rest: `--sc-line`. Hover (only
  under a pointer that can hover; touch would wear it until the next tap): the frame firms to
  `--sc-line-hover`, the picture brightens one step, and the puck in the corner says what the press will do
  (a plus). Pressed: the picture's own opacity, paint only. Focus: the ring on the frame, not the button,
  and the puck too. In the shot: the 2px inverse ring a picked shot tile wears, the tick in the corner, and
  under the pointer the tick becomes the x the press will do while the ring holds. Sitting out: dimmed,
  tooltip says why, answers no pointer. No picture: the frame with a placeholder glyph. Nothing scales or
  moves, ever. The rail's asset cards share the vocabulary.
- **Nothing re-deals on a pick.** The order a picker or the rail opened with is the order it keeps: the
  "suited to this product" band is read once at open, an attached item is ticked where it sits and never
  lifted to the front. A grid that re-sorts under the pointer reads as losing its place.
- **Already in the shot wears a tick and is a toggle.** The tick is the inverse puck the chip picker uses
  for what is on, keyed on the brief's own identity rule (`identityKeyOf`), so the tile and the rail can
  never disagree; the same press again takes the chip out through the brief's own remove, and the tick
  becomes an x under the pointer so the second press is never a surprise.
- **Every key stays in the picker.** Arrows walk the tiles by the grid's real column count (a roving
  tabindex), Up off the first row returns to search, Enter in search picks the first hit, Escape closes.
  All of it stops propagation: the shot overlay walks shots on the same arrows and closes on the same Escape.
- **Shots are the feed's own query.** Every finished shot of the brand, newest first, searched on the server
  and keyset paged 48 at a time, the way the Create grid turns its pages. The Create rail's Recent shots
  reads the same pages once its section is open, under the feed's own count, so the two doors agree; the
  workspace's recent shelf still leads there, because a shot that landed a moment ago is on the shelf
  before any page knows it. A brand with four hundred shots offered twelve in both places once.
- **Derivatives sized to the tile.** `small` (320) for a product, presenter or scene tile, `micro` for a shot
  or a mark; the curated JPEGs take `?w=` through the same routes.
- **Your own picture comes in three ways, through one door.** The Upload image button, a file dropped on the
  brief, and an image pasted into the brief or the picker all go through the composer's `pickFiles` and land
  as a reference chip at the caret. No second upload path, no references library.

### First use: a tutor, and Learn
Scenri is learned by using it. First use never tours the interface: a tutor stands beside someone while they do one real thing, says one thing at a time, waits for the product to say it happened, and follows the screen that happens on. The record is the install's (`GET /api/guide`, `POST /api/guide` intents only), so a phone on the network and a second browser agree. Who is new is decided once, at the first boot of a build that has the record: a home with no brand is new; a home with brands is someone upgrading and is never interrupted. Everyone has Learn.
- **One moment at a time** (`guidedTasks.ts` decides, `layout/GuideHost.tsx` draws it). Each task is one pure function: facts in, one moment out, the first rule that is true checked from the outcome back. Nothing counts steps and nothing stores an index, so resuming is the same question asked again, and a send that empties the brief never sends the tutor back to the start. A moment has three voices: **ask** holds the page (a curtain, the asked control lit and usable, everything else `inert`), **note** points at something that just happened and holds nothing, **quiet** draws nothing while the task stays in hand.
- **Only the one action.** An ask leaves exactly what it asks for usable: the add control, or the picker's shelf, or the brief and Generate together. Not the search beside the shelf, not the picker's own tabs (there are none while it asks), not its way to make a new one (Add product, Create presenter, Upload image are left out while it asks: a presenter made from there is a whole studio away), not the page behind. What else answers the same question stays usable too, never waited for and never handed the caret: the studio's own line where a typed sentence is the answer, the portrait beside the question about it. The card itself carries no work: **Back** undoes the last thing done. It takes the last chip out, shows the ask that put it there and opens the shelf on that kind again, so one press puts the choice back in front of them; on the first choice of a walk that began with the way to its place it goes back to Home and asks for that way again; on a later counted step it leaves the surface that step opened (the studio, the dialog, the shot). Every counted step after the first has it; the first step and the notes after a send have nothing to undo, so no Back. While the tutor is walking someone through the first shot's brief a chip can be changed but not removed, by any means: its remove control is hidden, its own panel offers no Remove, and every deletion that would reach a chip, Backspace and Delete and a select-all included, is refused, because Back is the one way anything leaves the brief and it leaves exactly one step. The same walk has one way in: `$`, `@`, `/` and `#` are characters while it is on, so every chip arrives through the ask for it. Someone who already knows them closes the guide and has them back. Only that brief is held: an open shot's composer and the Home dock never are. The words are still theirs to write and delete. **X** ends the guidance and leaves every chip and word where they are, **Done** closes the last note. The one exception is the opening, which has nothing to do yet and so carries **Start**.
- **Nothing advances on a click.** A moment is over when the product says so: a chip is in the brief, words exist, a picture finished, the brand holds one more presenter. Pressing Generate is not a finished shot, and opening the presenter studio is not a presenter.
- **The way to Create comes first when the first shot begins anywhere else** (the welcome, Learn). Nothing jumps and nothing is done to them: the first step stays on the page they are on and lights **Create** in the places (the tab bar's on a phone), ringed around its word, under a curtain that only dims (`rgba(0,0,0,.5)`, no blur, `Moment.soft`) so where they are stays plain to see (**Shots are made in Create**, which also says what a shot is built from). They open Create by their own hand, which is how they learn where it lives (2026-09-19: the old jump straight into a blurred Create left people asking what had just happened). Arriving by that step is the opening read, so the greeting is skipped, and the walk counts that step: `1 of 6` there, then the four asks as `2 of 6` to `5 of 6`, and the finished picture as `6 of 6`. Begun on Create itself, the greeting has no count and Open Create is already true, so the first ask is `2 of 6`. The way there is this page's alone: a reload or wandering off drops it, and nothing follows anyone around.
- **The first shot: a greeting, then four asks**. The greeting (**This is Create, where shots are made**, with Start) has nothing to point at, so it sits in the middle of the page it has just arrived on and says what a shot is built from before anything is lit: arriving on Create and being spotlit in the same instant leaves someone wondering how they got there. Then a product (**Choose a product**), a presenter (**Choose a presenter**), a scene (**Choose a scene**), then the words and the making as one act (**Say how to shoot it, then make it**, with the caret already in the brief at the end of the line, past the last chip, and Generate live beside it). The card says where it is, quietly, as `1 of 4`. Four is the ceiling on purpose: measured across 550 million in-app interactions (Chameleon), completion holds around 72 to 74% at three or four steps and falls below half at five, so the greeting carries no count and nothing else is added to the walk. The picker is the same moment followed into: it opens on the kind being asked for and shows only that kind, moves to the next kind as each lands, and closes itself when nothing is left to add. Nothing is ever put in the brief unasked. The settings are never asked about: they are optional and they explain themselves. With nothing that can draw, the one ask is the composer's own setup door (**Connect image generation**), and it is asked for only when there is a brief to generate.
- **Then the product answers**: a running take is a note on its tile (**Scenri is making it**), a finished picture a note with Done (**Your first shot**; on a tile that fills the screen the card comes inside its bottom edge), a failure a note on its tile (**That one didn't work**) that gives way the moment the brief is built again. Opening the shot it made is what finishes the task.
- **The spotlight** (`layout/coachGeometry.ts`): each lit surface is cut to the pane it scrolls in, not the target's (a portrait beside a transcript is not inside it), and a picture is cut at its own edge rather than padded like a block of text. Whatever the page mounts under a held page is held too, and a region kept for its announcements is walked rather than kept whole when the step sits inside it (the studio's transcript is a live log). The curtain is `rgba(0,0,0,.52)` under a static `blur(3px)`, only its opacity fades in; `.62` without blur where backdrop-filter is unsupported or transparency is reduced. It is deliberately light: at `.66` and a 6px blur the lit surface stopped reading as part of the page and started to look like a thing floating over it. The lit surface is the shape the asked control sits in, cut at its own edge and corners, so a control is never a hole in fog; what a live control opens (its popover, the phone's settings sheet) joins it while it is open, and a surface that opened out of another keeps that other lit beside it, so the composer never goes dark under its own picker. Inside that surface everything not usable recedes to a third of its strength. What every step asks for wears the same 2px ring 4px clear of its edge, on every step, whether it is a control, the shelf to choose from or the way to another page (a control far taller than its words, a place in the top bar, is ringed around the words); it breathes for as long as it is asked for and is still with reduced motion. Rings on some steps and not others read as two tutors, and a window without one read as a slightly lighter patch nobody could find. A card for one control sits against that control, so its pointer lands on the thing being asked for; a card for a whole surface (the picker, a dialog, a question, the brief beside Generate) clears that surface so it covers none of it. A card waits for the surface it belongs to to finish arriving before it shows, and keeps the side it first took while it fits: placed while the picker was still growing in, it appeared on one side and jumped to the other a frame later.
- **A phone gets the same card.** It is the same callout, pointing at the same control, with the same words: a phone changes where there is room for it, never what it is. What that costs is room, so the open picker gives up exactly the card's height and the air around it (`--sc-coach-h`, attach-panel.css) and the card stands above it rather than over it, whole on screen, its pointer on the thing being asked for (WCAG 2.4.11). Its buttons are at least 44px (WCAG 2.5.5) and the close is always in reach. This was tried as a bottom sheet, which is what Apple and Material prescribe for a touch screen, and it was worse here: three surfaces stacked to the bottom edge read as a wall of controls, and the card at the far end of the screen from what it was about stopped feeling like it was pointing at anything.
- **The other tasks find their place the same way.** Begun from Learn away from where they happen, the first step is the way there: Products, Presenters, Scenes or Create in the places, lit, taken by their own hand. Nothing jumps. A product then asks them to start a new one on that page, then one word on the dialog it is made in (**Add your product**), then quiet until the brand holds one more. A scene is the same walk to its library, then its studio, which asks its own questions, so the tutor says only what they do not: what a scene is, at the first question (**Describe the place, or start from pictures**), and at the read-back that those words are the scene (**These words are the scene**), then quiet until the brand holds one more. A presenter is the same walk to its library, then the studio: the studio asks its own questions one at a time, so the tutor says nothing through them. Three decisions earn a word, because the questions do not explain them (**Describe someone, or start from photos**, **Decide the face**, **Save your presenter**), each leaving the studio's own line usable where a typed sentence answers it (the description; the adjustment to a face), with the face itself in sight: the portrait on the stage, and on a phone, which has no stage, the conversation's own picture of it; and a wall earns a fourth, because a wall is not a question (**Set up image generation**, when nothing can draw a face). Refining: the way to Create, then **Choose a shot to change** on the grid (opening one, or Refine on its card: both are theirs and both land on the same ask), then **Change one thing** with the picture kept in sight, quiet while it draws, a note on the history strip where the change landed (**Here is the change**, never "version"); a change that fails is said on the history too (**That change didn't work**) until they step back to a shot with a composer. A task that makes something ends when the brand holds one more than when it began; closing its surface does not end it, and a presenter left with a draft is continued, that exact draft, from Learn.
- **The tutor may restore a place they have already been, and may never take them somewhere for the first time.** Continue, and only Continue, may open the exact Create, library, dialog or presenter draft the lesson had already reached. Start and Start again begin from where they are: if that is not the place, the way there is asked for again. Seeing the way is not having walked it. A leftover heading after a lesson lets go is cleared, so a fresh start is never confused with resume.
- **Tasks begin where they happen, never after each other.** From Learn, or for someone new the first time they open the presenter or scene studio, the product dialog, or use an open shot's composer (opening a shot is not asking to refine it). A surface begins its task at most once per visit. A task left on another surface gives way to the next; the first shot never does.
- **No checklist on Home.** Home's four create cards are already the ways in, and a list of steps above them said the same things twice, with a second behaviour behind the same words (2026-09-19, Tony's call, after a long concept round: every list, strip, deck and badge tried there read as the cards again). A lesson is begun from Learn, from the welcome, or where it happens, and never from a second button for the same act.
- **The words** say what to do in a few words, then why it matters, in the language of the product (a product is what you sell, a presenter is a person Scenri keeps, a scene is a place and its light) and never of the chrome (press, tap, click, +). None of unique, magic, credits, compare or heatmap, and never the title of the surface they sit on. `guidedTasks.ts` holds every word, the welcome's included, and `test/guidedTasks.test.ts` enforces the rules.
- **The welcome** (`views/WelcomeDialog.tsx`) is the one interruption, once, for someone new, the first time Home or Create is ready, rested and idle, held behind the tutor's own curtain (`DialogSheet tone="guide"`). It reads top to bottom like every dialog: **Welcome to *Scenri*** with its X in the corner, one plain sentence of what Scenri does (you choose the product, who shows it and where, and it makes the picture), one product shot in three worlds as the proof, then a friendly line about what happens next (made together, a step at a time; a short setup first when nothing can draw), and **Make your first shot** or **Not now**. Help's **Welcome to Scenri** opens it again (`?welcome=1`); seen that way it changes nothing in the record.
- **What's New waits for someone who knows the version.** A new install's first boot counts its own version's notes as read. While someone new has not answered the welcome, while anything of the tutor is on screen, and while the first shot is in hand, What's New never opens on its own.
- **Learn** (`views/LearnDialog.tsx`, the list in `lessons.ts`) is every lesson, for whenever someone wants one. A lesson is a guided task with a few words about it, never an article or a video: **Make your first shot**, **Add your product**, **Use it again**, **Create a presenter**, **Build a scene**, **Refine a shot**. **A lesson's steps are its walk's own moments, one list** (`lessons.ts` holds the milestones; each one names the tutor moments that are it, and `GuideHost` stamps the card from that). The card that says "3 of 6" means the third of the six steps Learn shows, with the same words: two lists that drifted apart taught two different things, which is why there is only one now. A step exists because the tutor can say it, so what pressing Start does is never a step of its own, and the way there is a step when they have to walk it. The greeting has no step and no count. **Use it again** is the one that teaches what the others only say: the same saved product in a different scene, so two pictures share one ingredient and reuse is seen rather than described (a schema forms by comparing two instances, Gentner, Loewenstein and Thompson 2003). It is Learn's alone, never begun by reaching a surface, and it says **Needs a product** until the brand holds one of its own. `lessons.ts` is the one list, and Learn reads done, in hand or new from the install record. **A lesson is done when it has been walked to its end, and by nothing else** (the record keeps which lessons finished, beside the `done` milestones the library proves). The two are different questions and were conflated once, which told someone with a full library that they had taken four lessons they had never opened: owning a product is not having taken the lesson about products, and the milestones keep their own job, which is stopping the tutor teaching what someone clearly knows. **Lessons are independent**: finishing one says nothing about any other, and the list is meant to grow. It is a dialog in the create dialogs' shell and lives in the address like Settings: `?learn=lessons` for every lesson, `?learn=<task>` for one. On a desktop it is one level (approved 2026-09-19): the five on the left (a 44px square picture, the name at 13.5/600, where it stands at 11.5, a small inverted **Next** on the first lesson in the list that is not done, even when a later one is already in hand, the chosen row on the chip fill, a hairline between list and lesson), the chosen one open on the right, opening on the lesson that comes next. The header carries the title, how many are done, and the X, and sits on a hairline; the list's hairline runs from it to the floor, which is why Learn is the one dialog that takes the shell's padding off the panel and gives it to the head and the body. **A lesson owns its progress; the screen is what one lesson has at a time.** The record keeps one entry per lesson begun and not finished (`progress` in `routes/guide.ts`): the brand its work is in, the window its shots and its draft are counted against, and the milestones it has reached, by their own names (`go`, `product`, `face`) rather than by a number, because a step is resolved against what the product holds now and a stored index goes stale. Beside them, one `active` says which lesson is guiding, because two cards on one screen is nonsense. Part done means past the first step: a lesson taken up and left standing on step one has produced nothing, so it says **Start** and how many steps it has, exactly as it did before it was opened, while its window is kept all the same. The engine ask is nobody's step either, for the same reason: nothing can draw yet, which is a thing to fix before the lesson means anything. So several lessons can be part done at once, each says **Continue**, and taking one up costs the others nothing but the screen: this was one slot before, which meant starting any lesson silently threw away how far another had got (2026-09-20). Closing the guide sets a lesson down without ending it; finishing it clears its progress, so taking it again begins a fresh window at its first step. **A lesson does not walk backwards** either: the tutor asks again for whatever is missing, so taking a chip out brings back the ask for it, but emptying a brief afterwards does not un-choose what was chosen. **A lesson already done is spent**: its name is struck through and the whole row stands back at half strength, coming back to full under the pointer, under the keyboard and while it is the one being read, because it can always be done again. That is the only strikethrough in the product. The lesson is its wide picture (21:9, at most 196px, 132px on a short screen), then its name at 20/600 with where it stands beside it on the same line, centred against it, one sentence held to two lines, and its steps as the action: one line each, 48px, room kept for four. **A step is its outcome and nothing else.** Descriptions inside the step rows were tried twice on 2026-09-20, on every step and then on the one in hand, and both read as a wall: the explaining belongs in the lesson's own sentence above, which is three lines long and never cut, and which the tutor never reads. That is what lets a lesson explain while a coachmark stays a few words. Only the step in hand can be pressed and it carries the verb (**Start**, **Continue**, **Do it again**, or **Make a shot first** for refining with no shot yet); a step behind it is done and one ahead cannot be reached, so neither is a button. **One shape at three strengths.** Every step is the same filled row (`--sc-raised`, 48px, the large radius), so the list never gains or loses boxes as a lesson moves; what changes is the ink. A step already taken carries its green tick alone (never a filled green disc, which four of them turn into the loudest thing in the pane) with its words at `--sc-fg2`; the step in hand takes the chip fill, its number on a filled disc, its own words at full strength whatever its state, and the verb as a pill, inverted to urge it and a ghost ring to merely offer it again; a step that cannot be reached yet keeps its row and recedes to `--sc-fg3`. **The strength is on the words, never an opacity on the row**: dimming the row dims its fill too, which reads as a missing piece rather than a quiet one. **Nothing moves between lessons**: the box is one height, and that height is what a lesson holds, measured rather than declared: the panel hugs its content under a `100dvh - 48px` cap, so the air under the last step equals the air above the picture, a short screen takes exactly the picture's saving off the box, and no hand-summed pixel is left over for the pane to scroll; the picture is one size, the sentence two lines, and the steps four rows, with the steps and anything said under them (refining, with no shot yet) inside one reserved block so a note costs no height. One gutter runs down the whole surface: the title, the pictures in the list and the picture in the lesson all stand on 24, which is why a list row's fill bleeds 8 to the left and the close button's glyph is pulled to meet it, so choosing another changes words and pictures in place. On a phone it is the sheet: the list first (64px rows, 48px pictures, names at 15), then one lesson over it with a back to the list, its step titles free to wrap. **Done is green** (`--sc-green`): the status, its tick and every done step's tick, Tony's call on 2026-09-19 and the one colour on the surface besides the pictures; still never a percentage, never a time. Every lesson has its own two pictures (`src/assets/lessons/`, a 480px square and a 1400 x 600 wide, each framed for its shape), made as one story: the product, the presenter and the place, then the first shot made from all three, then that shot refined. Starting closes Learn and hands over to the tutor where the task happens.
- **Learn is help, not a place.** The top bar's destinations are five, Home, Create, Products, Presenters and Scenes, because a nav slot has to earn itself against work done every session, and learning is not that. Learn is a ghost button at the bar's end, beside the bell (`layout/bar/LearnButton.tsx`): one word, no mark, the chip while its dialog is open. It opens over the page you are on and never takes a sixth slot. Below 1024px the bar has no room for a word, so Help, which sits in the bar there, carries it.
- **The help button** (`layout/HelpMenu.tsx`): *Learn*, *Welcome to Scenri*, *Keyboard shortcuts* (Create), *What's new*, *Set up image generation* (only while nothing can generate), *About Scenri*, *Scenri on GitHub*.
- **A new task** needs a real result someone gets from Scenri and a decision the surface cannot explain in its own words. A form's fields, a settings pane and a page's layout are never taught.

### Section Headers (`.sc-sec-head`)
- Flex row, title (15px/600) at the leading edge, an optional right-aligned action (ghost button, "+ Add X" pattern) at the trailing edge. **This is strictly a 2-slot contract**: title-group and trailing-action. A subtitle, when present, belongs inside the title group (its own inline flex with an explicit gap), never as a third top-level flex child, which is what produces glued text.

### Library Pages
The shared shell behind every curated-asset browsing surface (Products, Scenes, Presenters: "what / who / where"): one sticky row (`.sc-filterbar`): a facet's inline tabs at the leading edge, a result summary + Clear only while a filter/search is active, search, and a primary action, pinned right. No separate title/description band above it: the nav bar already names the active page, and a second header repeating it was tried and reverted: it reintroduced the two-thin-rows dead space this pattern exists to solve.
- **The facet control is always real, inline tabs, never a popover.** One rule (`facetMode` in `libraryRules.ts`) decides only whether there's anything to select between (`<2` values → hidden); 2+ always renders as tabs, regardless of count: a long list scrolls horizontally rather than hiding behind a click. One consistent visible pattern across every page beats a "smarter" per-page treatment that looks different page to page.
- **Search shows once a library clears ~8 items**, and may match more than the card displays (a Presenter card shows name + descriptor; its search also reads hair, skin, build, age): the search system is allowed to be smarter than the visible card.
- **A primary CTA slot may be visible before it's wired.** A not-yet-wired action renders as a ghost button: its presence signals intent even before it does something, and ghost is the tell that it is not the loud, working action yet.

### Create dialogs (product)
A create dialog is a picture being named, not a settings panel. Empty: one large drop well. Filled: a 4:5 grid of references. Name and notes are labeled `.sc-in` fields, the same control as Settings, not a second input style. Filing is optional chips under a quiet legend. The chooser is one press; the forms do not grow a second step. Product stays on this 440px one-step shell. Scene left it for its own studio (below), because a place is judged on a picture drawn from it and changed a sentence at a time, which a one-step form cannot hold.

### The presenter studio: a conversation, a view, an editor
A presenter is made in a short exchange, not a form. The studio has an address, `/presenters/new` for a fresh start and `/presenters/new/:draftId` once there is a draft (`PresenterStudioRoute`, `.sc-pstudio`), a child route of the library the way the shot overlay is of the hub: full-bleed over it, the library still mounted, every move inside replacing so Back and the close are the same move, a reload landing on the same step. The old `?new=presenter` forwards there; Product, a short form, stays a dialog. The stage on the left holds the one picture being judged (the well, 4:5) and the strip under it (90 x 112 tiles, the label under each, the one on the stage outlined, a mark on what stands); the 500 rail on the right is the conversation. On a phone there is no stage: the head, the transcript scrolling (pictures and all), and the composer above the keyboard.

The conversation is the app's Question primitive (`conversation/`: `Transcript`, `ScenriTurn`, `YouTurn`, `QuestionBlock`, `ConversationComposer`, rules in `question.ts`), which any conversational surface renders. A turn is yours (a bubble on the right, under the line it answered, with a pencil while it can still be changed) or Scenri's (the mark and the name in a 32 row, the sentence at 15/22 under it). A question is Scenri's line with its answer under it: a choice answers on the tap, grouped choices answer together on their button, photographs are a block with their own count, removal and confirmation, a decision is one primary and its quieter alternatives, and a sentence has no control of its own because the composer under the transcript is the answer. Four kinds, no more, and every question has a stable id: a flow keys its state on ids, never on a turn's position or its words. The transcript is computed from state on every render and stored nowhere; the words in it are product copy from the flow's rules, and no model is ever asked for them. A line arrives once, when it is written: word by word, a beat (180ms) after the turn before it, never past seven tenths of a second, its controls fading in after it has been read; what has been said is remembered for the conversation, so a reload, a fold or a remount never replays it; reduced motion removes all of it; the sentence is whole in the DOM from its first frame, so a screen reader hears it once. Rhythm from the frame: 32 gutters, 32 between turns, 8 from a line to its answer, 12 from a line to its controls, the composer card at radius 22 with a 1px border, the field at 15/28, a 38 pill, and nothing under the card: what cannot be done is said in the conversation when it matters, never as a standing line.

Creation asks one thing: who are we creating, describe someone new or add photos of a real person. A typed sentence there is the description and no door is asked. From a sentence, one follow-up at most, when the sentence leaves out what a roll cannot guess (who, age, and build when short), as rows of chips answered together or skipped; the face draws on its own, the name is asked while it draws, and the face is the one decision (Use this person, Try again, or a sentence that adjusts it while keeping the person). From photographs, one to four, the first the face and the rest drawn from it, the likeness confirmation inside the block; an identity ask against a photograph is refused in one line. Then the set builds itself, three core views (Face, Full body, Three-quarter: the three references a brief transports), each landed view deciding itself and keeping the one it replaced behind a quiet Keep previous; one turn offers the back and profile views, built the same way and transported when a shot asks for that angle; a name if none was given; Save presenter. A changed answer costs what depends on it: the name nothing, the sentence after a face the face, the source or the photographs a Start over. A saved presenter lands on its own page.

The page is the record, in three zones and no more. The identity is centred and tight: the avatar as a circle (through `presenterVisual`'s one chain, never a picture picked and enlarged on the spot), the name, a caption, then Use in a shot, Edit presenter, and a quiet pencil. The reference set is the middle zone and the only thing on the page that leaves the 1080 column: one row at any count, three standing at a time at the size a full-length figure can be read, the rest a press of an arrow or a swipe away, each tile 4:5 and letterboxed rather than cropped, labelled by role where the record gives one and numbered where it does not, opening at full size in the app's lightbox. Under it the source photographs in a small row, and then the record itself: a left-aligned list of label and value (Age, Filed under, Origin) with Delete last. Nothing there changes a picture or the person, and nothing reads as a form: the name and the caption are a heading and a caption, and the words on the record are changed in one Details sheet behind the pencil, which is not Edit presenter. The casting prose the generator is given is not shown here; it belongs to the editor that writes it. The editor (`/presenters/:presenterId/edit`, a child of the page) is the same surface on a session seeded from the record: it opens without spending a generation, with that seeded history already said rather than written out to you a line at a time, asks what should change, and aims a sentence by a table (`presenterEditRules.ts`): a likeness complaint or a capture correction repairs the view on the stage; a trait verb changes the person, decided on the face before the views built on it follow; wardrobe, products, places and lighting belong to Create and are said so; a sentence that reads both ways is asked once. Accepted candidates change the session; Save changes writes a new revision when a picture or the person changed (the old record stays, superseded, so a shot made with it keeps refining against the person in it, while a shot started again from it carries the person as they are now) and patches in place when only words did; Discard changes leaves the record; Revert last change walks one revision back; a superseded address lands on the current one. No published state, no assistant prose, no engine call spent on words.

### The scene studio: the same conversation, about a place
A scene is the place and its light around a shot, and a shot is told it in words. It is made in the presenter's studio (the same frame, transcript, composer and stage, `.sc-pstudio[data-kind="scene"]`, at `/scenes/new/:convoId` and `/scenes/:sceneId/edit/:convoId`, a child of the library and of the scene's page), asking a place's questions and never a person's. The first question has two doors, pictures of the place or a few questions, and a sentence typed there is the place itself: it is read for what it already decides (the world, the light, how the subject sits, the camera), and only the world and the light are ever asked after it, world first, none once three are said (`sceneIntent.ts`). The questions are two rows, each skippable and each answerable in words: the world it is, and whether to keep the light that world already has. How the subject sits and where the camera stands are never asked. Both were rows once, and an answer to either is written into the place's words, which every shot is told: "on a plinth" stood every product and every presenter on a plinth, and a camera held every shot to one view. They belong to each shot, and the scene's example set (below) shows the place from several. They were five (place, light, feeling, material, figure), which is a taxonomy asked before anything is on screen; nobody pictures a shot from an adjective, and "Warm" or "Wood" made the decision harder. A world is a starting direction, not the final picture: eight worlds each hold the same plain unbranded bottle so they are compared rather than admired, and the lights stand in one unchanged plaster room. A world passed over its light keeps the light its own card was photographed in. A phrase typed at the first question answers the rows it names and only the rest are asked; a whole description still skips all of them. Passing every row is allowed and spends no reading: there is nothing to read, so the line stays open and says so. Once the place is given it is read, the one thing the studio does on its own, and read back as **What your shots are told**, the words every shot will get, with one **Draw the scene** under it and the line open for anything to add or leave out; nothing is drawn without that press. The picture lands with one decision, **Use this scene**, **Try again** (the same words, a new picture) or **Change something** (a sentence that revises only what it names and changes the picture from the one before), and every version is a pair of words and picture that **Put back** restores whole. The name is asked while the first picture draws, with the reader's suggestion as a starter, and a sentence that names it ("call it Stone Hall") names it wherever it is said and draws nothing. The conversation reads forward here too: an answer the picture was drawn from asks once before its pencil opens it, because changing it takes back the pictures with everything else asked after it, and the Confirm says the change line is the way to keep the picture and alter one thing. A version is the candidate until Use; nothing is saved before it and nothing rejected reaches Create. Use saves, and the conversation goes on to the place in use (below). A sentence asking to cast a presenter or place a product is answered in one line (they belong to Create), and a scene's pictures are read into words, never sent with a shot, except a figure-led scene's preview, which is the plate a shot beside a presenter conditions on. A scene's own page is a record, and wears the presenter's page: no breadcrumb, the centred identity (the name, where it is filed as the same static chips, what it is in one sentence), one verb, then the pictures. A scene with ways to shoot it keeps them **on** that verb as a split button rather than in a band of their own: a way is how Use in a shot is pressed, and a way is written, renamed or taken away in Details, never on the page. The pictures are the middle zone and the only thing allowed to leave the column: the place and its examples side by side in the rail a presenter's views use, each labelled by its role and one still drawing shimmering in its tile (a place with nothing beside it stands alone at the size it was drawn). The page draws nothing: the one thing a picture there offers is Shoot it this way, when it shows a tested way, and more pictures are asked for in the studio, through Edit scene. Then what a shot made here is told, as the three keys that are real (Light, Camera, Built around) with one sentence under them saying that a shot's own words win, which is what the compiler actually does. **The set prose is not on this page**: it is eight hundred characters written by the reading, it is changed by re-reading the place, and it belongs to the studio that writes it, exactly as a presenter's casting prose does. Last: what it was read from in the presenter's own sources row (From your photos), the footnote (what its pictures are, said once there rather than as a caption that read as the middle picture's, then what it was read from and how many ways it keeps), Delete, and the shots made here. Two passes in 2026-09 gave this page a two-column grid of its own, four band heads and three paragraphs explaining the mechanics; it measured the same word count as the product page and read as three times the work, because the cost is the number of times the eye has to stop, not the number of words.

A scene's work belongs to the server, not the page. The conversation has an address and is kept in the browser under it; a draw runs whatever the page does, one per conversation, and Back, a reload, the bell or the Scenes wall brings the person back to it. Closing the studio with anything in the conversation (words read, a picture, a draw under way, a draw that failed) keeps it as a draft on the Scenes wall, first, with the draft card presenters use: Drawing, Not drawn yet, Drawn, not used yet, or Did not finish. It is thrown away only by its own Discard; leaving asks only before anything has been read. Stop is the composer pill whenever something runs and the line is empty, and every stop says what it left and offers the way on.

What a scene is, measured (2026-09-22, real Codex, blind-judged): the words are the scene, and one clean picture is their proof. A scene picture with a product or a person in it leaks into shots (a presenter wore the planted woman's dress and pose in 2 of 2; a necklace stood where a planted bottle stood in 2 of 2), so no scene picture ever holds a subject and there is no default product. The clean picture handed to a shot makes the shot more like the scene, but copies its framing (5 of 9 near copies, and two different shots in one scene came out alike), while the words alone keep the place and let each shot frame it anew. So the picture reaches a shot only where words cannot carry the look: a figure-led treatment beside a presenter. No supporting views, no contextual previews, no "use this view": a scene is one place, and its setups (camera lines) are how it is shot more than one way.

Measured again the same day (GPT Image 2 and 2.5, the model Codex draws with, a brutalist hall authored in the studio, a mini-campaign at 1:1, 4:5, 16:9 and 9:16, judged blind): four references do not make a better world. Two extra clean views of the place made shots copy them more (likeness to the scene 0.50, against 0.40 for one picture and 0.27 for words alone; a top-down and a low-angle shot came back as the ledge view); a preview with a person in it put her linen suit and pose on the next presenter; the words alone gave the most varied shots and still read as one campaign. Previews with the person's real product and presenter are good photographs, and they are what Use in a shot already makes. What a product needs is its real size, and prominence is never size: the scene photograph's objects are set at their real size and stand in for nothing attached (the old stand-in line put a sneaker in a loft's armchair's place, at its size); a product alone in a place is framed at its own scale with focus following distance, whatever camera the shot names; worn and held are said only when someone is attached to wear or hold it (said to every product, it drew a man into an empty loft to wear the sneakers). A product smaller than a hand in a room-scale world comes out two to six times too big on these models whatever the words say, a camera close-up or a stated size included (about 5 of 40 passed); GenScale later published the same bias. So a small product alone in a place with its own picture is drawn in two steps (productScale.ts): the place first, empty, with nothing in it to inflate, at the magnification the product is really photographed at, so the frame spans four product lengths; then the product placed on that picture at a quarter of its width, the share the model gives any object, which is now also its true share. The model cannot choose the magnification itself, so the size is data, and nobody is asked for it: it is read once from the product's photograph and kept per brand, a store's listed size is believed over the reading, and the person's own correction, made in the product's Details sheet behind the pencil like a presenter's or a scene's, is believed over both. The size that holds reaches every compile as the product's dimensions, so a presenter holding it is told how large it is too. The plate never carries the room's words as its view (a plate that did was drawn as the room at every span), and light keeps its real size on it. Judged blind against known-good and known-bad controls on GPT Image 2.5: every product from a 7 cm watch to a 38 cm tote passed on the concrete world, top-down, low-angle, 1:1, 9:16 and 16:9 included (7 of 7), and contact, shadow and gravity passed in all 25 judged. Two limits stay open and are measured, not guessed: a ring-sized product (about 2 cm) still reads about twice its size from the surface's grain, 7 of 7 with these prompts, down from two to seven times (the model draws texture at one pixel size and places any object at a quarter, and asked for an eighth it drew a quarter; the only two ring passes came from a plate that named the concrete itself); and a place whose own picture is striped by window bars keeps a row of room-sized stripes on the close plate whatever the words say (four wordings, eight plates, 4 of 4 loft placements judged too big from the stripes alone).

The place in use (2026-09-22). A made scene ended on one picture where a system scene shows a set of six, so a made scene gets a set of its own, drawn in the conversation the way a presenter's views are. The place picture is the one approval, Use this scene, which saves, so leaving at any point loses nothing. Then a hero and a close-up are drawn by themselves with a Scenri demo product, or a demo presenter for a world built around a person, picked by the scene's categories and the same every time for the same scene; then **Add three more?** (hands, another angle, a bold one; two for a person, or for a place already staged in hands) with Add them and Not now; then the last press, Open scene, or Use in a shot when the studio was opened from Create. Each picture lands as a turn with Try again in the Put back slot, the stage strip is the place and its examples, and Stop keeps what landed. Every example is drawn from the place picture, never from words alone (examples drawn from words drifted to another place): the hero through the compile a real shot takes, so a small product is drawn at its own scale, and the rest as edits of the hero. They are shown and never handed to a shot or exported, and a picture replaced or removed is released. A new place picture redraws the roles the set had. Nothing starts while Scenri's library is not downloaded, and the conversation says so rather than failing twice. One gate then automatic follow-ups is the presenter's rhythm; the cost is said in Activity, two or three draws after Use and three to five more on asking.

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
- **Do** let the ring answer the keyboard only. `html[data-input]` (`inputModality.ts`, installed before the first render) says which hand moved last, and every rule that answers `:focus-visible` for a control carries the zero-specificity prefix `:where(:root:not([data-input="pointer"]))`, so a click never leaves a ring, even when Radix hands focus back to a menu's trigger as it closes. Focus itself is never dropped, blurred or suppressed for this: keyboard and screen reader users need it back where they were. Places to type are the exception and show their focus whichever hand put the caret there. Tooltips and hover-style peeks opened by focus follow the same rule (`Tip`, `SitOutTooltip`, `keyboardFocus()`). `test/focusRingGate.test.ts` fails on a new `:focus-visible` rule without the prefix.

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
- **Do** state hover and open on a bare mark with a 2px ring in `--sc-chip` (`--sc-fg3` pressed or open), the way the top bar's brand control does. A mark that fills its own circle has no background to shade and no label to darken, so the ring is the only treatment left. It is the sanctioned exception to the line below and stays one: a control that does have a surface uses the shared treatment.
- **Don't** invent a per-component focus or active treatment: a `border-color` swap, a box-shadow halo, a background change. It reads as a second vocabulary for a state the user already knows, and the two drift apart the moment either is touched; add to the shared list in `styles/foundations/interaction.css` instead.
- **Don't** style an unwired CTA as primary (inverse-fill). Ghost is the tell that it's not the real, working action yet.

### Writing

Product copy is part of the design system. The voice is plain, factual and specific: say what
happened and what to do next, in the words the interface already uses. Contractions are fine.
Sentences are short.

- **Talk about the work, not the technology.** A shot rendered, a prompt was kept, a key was
  refused. Never AI magic, never marvel at the model.
- **On screen the sentence is the prompt.** PROMPT over a shot's record, Copy the prompt, Write a
  prompt first, Jump to the prompt. "Brief" is the code's name for the record (`brief`,
  `compileBrief`, `BriefLine`) and never reaches a person.
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
