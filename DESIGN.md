---
name: scenri
description: The open studio for brand-consistent AI visuals — dark, imagery-first, quiet chrome
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

# Design System: scenri

## 1. Overview

**Creative North Star: "Scenri UI"**

scenri is a working instrument for people doing brand-consistent AI product photography, not a marketing surface. Dark by default, near-black ground and near-white ink, so the product photography (the actual content) reads as the brightest, highest-contrast thing on any screen. Chrome — nav, filters, section headers, buttons — stays quiet: hairline borders, flat surfaces, restrained type. The system carries exactly one accent color, gold (`#f5c518`), and it is rationed hard: credits, the keeper star, and in-flight shimmer only. Nowhere else. A single serif italic voice (Playfair Display) appears at most once per screen, on a headline, never competing with the working sans.

This system explicitly rejects the generic-SaaS-dashboard reflex: no identical icon+heading+text card grids, no gradient-text emphasis, no hero-metric tiles, no tiny uppercase tracked eyebrows stacked above every section, no cream/beige "AI-default" palette, no colored side-stripe borders as a decoration. It is not shy of hierarchy, but the hierarchy comes from spacing, weight, and restraint, not from ornament.

**Key Characteristics:**
- Dark ground, near-white ink, imagery does the color
- One accent (gold), rationed to credits / keeper / shimmer
- Flat surfaces at rest, hairline dividers, shadows reserved for anything that floats above the page
- Pills for interactive controls (buttons, chips, tabs) — full radius, not rounded-rect
- One serif italic phrase per screen, headings only

## 2. Colors

Near-monochrome dark ground with a single rationed accent; imagery supplies the rest of the color on any given screen.

### Primary
- **Signal Gold** (`#f5c518`): the one accent. Used only for credits pill, keeper star, and in-flight generation shimmer. Never a UI-chrome default (buttons, active tabs, links, focus rings all stay monochrome). Its rarity is what makes it legible as "this matters."

### Neutral
- **Void** (`#0d0d0d` dark / `#ffffff` light): page background.
- **Panel** (`#141414` dark / `#ffffff` light): raised surface background (dialogs, cards' immediate container).
- **Raised** (`#1a1a1a` dark / `#f6f6f6` light): one step up from panel — active/on-state chrome fill (e.g. `data-on` icon buttons).
- **Ink** (`#f5f5f5` dark / `#0a0a0a` light): primary text, and the inverse-fill used by primary buttons and active chips/tabs.
- **Ink Muted** (`#9a9a9a` dark / `#666666` light): secondary text — subtitles, counts, helper copy.
- **Ink Faint** (`#6b6b6b` dark / `#9a9a9a` light): tertiary text — placeholder-weight, deep-muted labels.
- **Hairline** (`#262626` dark / `#e8e8e8` light): default border/divider.
- **Hairline Strong** (`#383838` dark / `#d4d4d4` light): hover/emphasis border state.

### Named Rules
**The One Accent Rule.** Gold appears in exactly three places: the credits pill, the keeper star, and in-flight shimmer. If a new element reaches for gold to look "on brand," that's the tell it should reach for ink/inverse-fill instead.

**The Imagery-Does-The-Color Rule.** Product and look photography is the only place saturated, varied color is allowed to run free. Chrome stays monochrome so it never competes with the work being art-directed.

## 3. Typography

**Display Font:** Inter Tight Variable (with Inter Variable, -apple-system, Segoe UI, sans-serif fallback)
**Body Font:** Inter Tight Variable (same stack — one working sans, weight does the differentiating)
**Accent Font:** Playfair Display, italic only

**Character:** A precise, geometric-leaning working sans carries every screen; Playfair Display italic is a single accent voice, not a second typeface competing for attention — it shows up on one headline per screen at most, never in UI chrome, labels, or body copy.

### Hierarchy
- **Title** (600, 15px, -0.01em tracking): section headers (`.sc-sec-title`) — "Products," "Palette," "Scenes."
- **Body** (400, 13px): default UI copy, descriptions, list content.
- **Label** (500, 12.5px): chips, tab counts, small metadata.
- **Mono**: technical/numeric readouts (briefs, costs) where fixed-width matters.

### Named Rules
**The One-Serif-Phrase Rule.** Playfair Display italic appears at most once per screen, on a heading. It is a punctuation mark, not a voice the interface speaks in.

**The Measure & Wrap Rule.** Display copy uses three shared measure tokens — `--sc-measure-title` (22ch), `--sc-measure-lede` (48ch), `--sc-measure-prose` (62ch) — wired through surface selectors in `tokens.css`. Titles (`greet`, lookpage h1, empty h3, bandhead) get `text-wrap: balance`; ledes, empty body, lookpage notes/facts, and settings blurbs get `text-wrap: pretty`. Never apply balance/pretty or measure caps to chips, tabs, buttons, filter labels, truncated one-liners, or composer prose. Utility classes `.sc-text-title` / `.sc-text-lede` / `.sc-text-prose` exist for one-off display copy without a dedicated surface class. On narrow viewports, title measure softens to ~26ch; lede/prose stay in `ch`.

## 4. Elevation

Flat by default. Surfaces sit at the same visual plane with a 1px hairline border doing all the separation work at rest — no ambient shadow on cards, panels, or section chrome. Shadows exist as a strict three-step scale and are reserved for things that are genuinely above the page: dialogs, overlays, the floating composer dock. Shadow presence itself is the signal "this floats," so using it decoratively on a resting card would blunt that signal everywhere else.

### Shadow Vocabulary
- **shadow-1** (`0 1px 3px rgba(0,0,0,.4)` dark / `rgba(0,0,0,.07)` light): the lightest lift — hover state on an otherwise-flat control.
- **shadow-2** (`0 10px 30px rgba(0,0,0,.28)` dark / `rgba(0,0,0,.12)` light): floating dock, popovers.
- **shadow-3** (`0 18px 50px rgba(0,0,0,.34)` dark / `rgba(0,0,0,.18)` light): dialogs, full overlays.

### Named Rules
**The Flat-By-Default Rule.** Nothing gets a resting shadow. If it isn't floating above the page (dialog, overlay, dock), it gets a hairline border and nothing else.

## 5. Components

### Buttons
- **Shape:** full pill (`border-radius: 999px`), 34px height, 16px horizontal padding, 8px icon-to-label gap.
- **Primary:** inverse fill — ink background, page-background text (`--sc-inv-bg` / `--sc-inv-fg`). Hover: 0.88 opacity, no color shift.
- **Ghost:** transparent fill, ink text, hairline border. Hover: raised background + stronger hairline.
- **Danger:** transparent fill, red text and hover border, otherwise identical to ghost.
- **Focus:** 2px solid outline in `--sc-focus` (= ink), 2px offset. No glow, no color change.

### Chips / Tabs
- **Style:** transparent fill, hairline border, muted text (`--sc-fg2`), full pill radius, 5px/12px padding, 12.5px/500 label type.
- **Active state:** inverse fill (same ink-on-bg treatment as primary buttons) + weight bumps to 600. Never gold — active state is a monochrome inversion, not a color change.
- **Category tab row (`.sc-verticals`) is the exception to the pill shape:** flat text-in-a-row with an underline for the active state, not a chip. Both patterns exist in the system; don't cross them — a tab strip stays underline-style, a filter/chip cluster stays pill-style.

### Cards / Containers
- **Corner style:** 14px radius (`--sc-radius-lg`).
- **Background:** panel color, no shadow at rest.
- **Border:** none by default; the grid gap (14px) does the separation.
- **Internal padding:** image fills the card at a fixed 4:5 aspect ratio; caption/label sits below in a fixed-height footer.

### Inputs / Fields
- **Style:** hairline border, panel background, `--sc-radius` (10px) corners.
- **Focus:** border shifts to `--sc-focus` (ink), no glow/ring beyond the border itself — consistent with the no-decoration-at-rest posture.

### Composer insert menus (`/`, `@`, `#`)
A caret (or phone-docked) shortlist, not a command palette. The three triggers share one shell (`.sc-cmd`, `--sc-z-popover`) and one ranking rule (`pickList` / `insertShortlist`). `/` is products, `@` is presenters, `#` is scenes — each menu carries that label at the top. Typing in the brief is the filter — no inner search field, no cap banner, no keyboard-hint footer. Empty query is a ranked shortlist; a typed miss stays open with one quiet line. Colors, marks and shots stay on the attach panel. Structured chips and `compileBrief` IDs do not change.

### Section Headers (`.sc-sec-head`)
- Flex row, title (15px/600) at the leading edge, an optional right-aligned action (ghost button, "+ Add X" pattern) at the trailing edge. **This is strictly a 2-slot contract** — title-group and trailing-action. A subtitle, when present, belongs inside the title group (its own inline flex with an explicit gap), never as a third top-level flex child — that's what produces the glued-text bug this pass is fixing.

### Library Pages (`docs/product/patterns/creative-library.md`)
The shared shell behind every curated-asset browsing surface (Products, Scenes, Presenters — "what / who / where"): one sticky row (`.sc-filterbar`) — a facet's inline tabs at the leading edge, a result summary + Clear only while a filter/search is active, search, and a primary action, pinned right. No separate title/description band above it: the nav bar already names the active page, and a second header repeating it was tried and reverted the same session — it reintroduced the two-thin-rows dead-space problem this pattern exists to solve.
- **The facet control is always real, inline tabs — never a popover.** One rule (`facetMode` in `libraryRules.ts`) decides only whether there's anything to select between (`<2` values → hidden); 2+ always renders as tabs, regardless of count — a long list scrolls horizontally rather than hiding behind a click. One consistent visible pattern across every page beats a "smarter" per-page treatment that looks different page to page.
- **Search shows once a library clears ~8 items**, and may match more than the card displays (a Presenter card shows name + descriptor; its search also reads hair, skin, build, age) — the search system is allowed to be smarter than the visible card.
- **A primary CTA slot may be visible before it's wired.** Products' CTA is real today (Upload/Import); Scenes/Presenters show "Create scene"/"Create presenter" as visible ghost buttons ahead of the backend route existing, at explicit product direction — the button's presence signals intent even before it does something.

## 6. Do's and Don'ts

### Do:
- **Do** keep gold to credits / keeper star / shimmer only — nowhere else, including active filter/tab states.
- **Do** use a hairline border as the default separator; reach for a shadow only when something is meant to read as floating above the page.
- **Do** treat `.sc-sec-head` as a 2-slot contract (title-group, trailing action); nest a subtitle inside the title group with its own explicit gap, never as a sibling flex item.
- **Do** keep every interactive control (button, chip, tab, input) on the existing radius/height scale — 34px controls, full-pill chips/buttons, 10px field radius.
- **Do** let product/look photography carry the color on any screen; keep surrounding chrome monochrome.
- **Do** reach for the shared active inversion (`--sc-inv-bg`/`--sc-inv-fg`) for any new on/off control — the scene card's bookmark toggle is the worked example. Gold is not an on-state; it belongs to the keeper star, and one colour cannot carry two meanings.
- **Do** give every new focusable control the system's one focus treatment — `outline: 2px solid var(--sc-focus); outline-offset: 2px` — by adding its selector to the shared list in `tokens.css`, and give fields the same ring via `:focus-within` (`.sc-swap-search`, `.sc-assets-search`). The only sanctioned variation is `outline-offset: 1px` where a control sits in a tight grid or inside another control's border and 2px would collide or spill.

### Don't:
- **Don't** use gradient text, hero-metric tiles, or identical icon+heading+text card grids — the generic-SaaS-dashboard pattern this system explicitly rejects.
- **Don't** use a colored side-stripe border (`border-left`/`border-right` as an accent) anywhere.
- **Don't** add a tiny uppercase tracked eyebrow above a section as default scaffolding.
- **Don't** apply gold to a UI-chrome default state (active tab, focus ring, link color, button fill) — that's the rationing rule breaking.
- **Don't** give a resting card, panel, or section header a shadow "for depth" — flat + hairline is the rest state; shadow means floating.
- **Don't** stack a subtitle, a header title, and a trailing action as three siblings in `.sc-sec-head` with no gap — this is the exact bug this pass fixes; wrap title+subtitle together instead.
- **Don't** put a "Create new" tile as the first item in a catalog/library grid. It disrupts a visual-comparison surface, shifts scan position on every return visit, and duplicates the header's own primary CTA — evaluated and rejected for the Creative Library pattern, not merely unconsidered.
- **Do** let a dialog surface hold focus silently. Every dialog pairs `onOpenAutoFocus={focusSelfOnOpen}` (`app/dialogs.ts`) with the one shared `.rt-BaseDialogContent:focus` → `outline: none` rule in `tokens.css`. Without the JS half Radix aims at the close button and the dialog opens wearing a ring around its ×; without the CSS half the ring simply moves onto the surface. Neither half is optional, and neither is written per dialog.
- **Don't** invent a per-component focus or active treatment — a `border-color` swap, a box-shadow halo, a background change. It reads as a second vocabulary for a state the user already knows, and the two drift apart the moment either is touched. This has been fixed once already, on the Create rail's search field; add to the shared list instead.
- **Don't** style an unwired CTA as primary (inverse-fill). Ghost is the tell that it's not the real, working action yet — Scenes'/Presenters' "Create" buttons are visible ahead of their backend route, deliberately never styled as loud as Products' real "Add product."
