# The presenter lifecycle

What a presenter is at each point in its life, what owns it there, and what may
move it on. Written from the code after the 0.10.0 hardening pass, not from
intent: where this and the code disagree, the code is right and this is a bug.

The conversation itself (questions, rewind, transcript) is the `conversation-flow`
skill. This is the lifecycle around it.

## The three entities

| | Identified by | Lives in | Dies when |
|---|---|---|---|
| A conversation | the history entry it is being had in (`location.key`), then the draft's id | `sessionStorage`, one bucket per conversation | the tab closes, or it becomes a draft, or it is started over |
| A draft | `pd-<uuid8>`, server-assigned | a `presenter_drafts` row | saved, discarded, or fourteen days untouched |
| A saved presenter | `up-<uuid8>` in `brand.json.characters` | the brand document | deleted, or superseded by a revision of itself |

An editing session is a draft row carrying `presenterId`. It is not unfinished
work, so the wall does not list it; the presenter's own page offers it back.

## The rule that holds it together

**The URL names the entity. Nothing else decides which one is open.**

`/:brandSlug/presenters/new` is a new conversation, every time.
`/:brandSlug/presenters/new/:draftId` is that draft.
`/:brandSlug/presenters/:presenterId` is that person.
`/:brandSlug/presenters/:presenterId/edit` is a session over them.

Before a draft exists there is no id to key a conversation's answers by, so it
is keyed by the history entry: a push or a replace mints a fresh `location.key`,
and a reload and Back and Forward each restore their own. `ScrollPane` keys
scroll offsets the same way.

This replaced two session keys that decided it instead, and both were scoped
wider than a conversation: a brand-scoped pointer that the bare route silently
replaced into, and one pre-draft answer bucket per brand. Between them, Create
presenter could open a draft from two days ago with its face already on the
stage. Neither key is read any more, and `presenter-drafts.spec.ts` writes both
by hand to prove it.

## Creation

Two doors, one answer: `source` is `scratch` or `photos`, and changing it takes
the whole run behind it (`commit` in `presenterQuestions.ts`). They cannot both
be answered, and photographs uploaded under one do not come back under the other.

A draft row is minted the moment nothing is left to ask: from a description that
is whole, or from Continue on the photographs. Before that there is no row, so
opening the studio and closing it leaves nothing behind, on the server or in
storage.

Views build in order, each drawn from the approved ones before it: face, full
body, three-quarter, then back, left and right on request. The face and the full
body are decided by hand; every other view decides itself and keeps what it
replaced, so Keep previous is still on offer.

## What a candidate is

A `ViewSlot.status`, on the server row: `empty | generating | candidate |
approved | stale`. A candidate is a picture waiting for a decision. It is never
canonical: nothing outside the studio's own stage reads an unapproved hash, and
the wall hides editing sessions entirely, so a candidate cannot reach the
library, a picker or a chip.

**A picture drawn from a face that moved while it drew lands `stale`, not
current.** A draw takes tens of seconds and what it reads from can be decided,
redrawn, put back or restored underneath it; `staleDependents` cannot help,
because it only moves views that are approved or candidate and a view being
drawn is `generating`. The picture is kept, because it cost a generation and the
log can offer it back, but the set says it has to be drawn again.

## The moment it opens

The studio is a child route of the wall, so `PresentersView` never unmounts: a
full-bleed surface is laid over a library that is still there, still scrolled
where it was. That is what the arrival is made of. It travels the way every
other surface for making a new thing travels, per form factor and on the same
curve as `add-to-brand`: a sheet up from the bottom edge on a phone, a short
rise and a 2% zoom on a desktop. The same keyframes, not copies.

It lands with the conversation's own first beat rather than before it, and it
plays once: the route pattern is one object with no key, so gaining a draft id
changes a prop and never remounts the surface.

Nothing moves after it lands. The line under the composer says what the studio
will spend, from the first frame, the way the scene flow does. It used to say
"Checking the engine..." and then unmount when the probe answered, which moved
the composer 35px while the first question was still being spoken.

**A route that names a draft asks nothing until it has one.** With no draft
loaded the flow looks exactly like a new conversation, so it asked the first
question, the record landed on top of it, and it was taken away a render later.
The transcript grew by that question's height and shrank back, and because the
newest turn is pinned to the bottom of the rail, everything above was thrown up
and came back down. Nothing said is unsaid: a transcript that shrinks while it
opens has taken something away, and the pin turns that into a journey.

**A picture the browser already has is simply there.** The well carries a
transition, not an entrance animation: an animation plays on mount, when the
picture is usually already decoded, and does not play on a change, because the
element is reused and a CSS animation does not restart when `src` does. So it
dimmed what was already on screen and brought it back up, and never
cross-faded the swap it was written for. A picture that has not arrived has no
bitmap to show, so it waits at zero and comes up as it arrives.

## What each control does, and what it costs

Every control that can spend a generation or throw work away, in one place. All
four defects reported by hand on 2026-09-16 were a control doing one of the
other rows' jobs, so a new one goes in this table before it goes in the UI.

| Control | Changes | Spends a generation | Throws anything away |
|---|---|---|---|
| Use this / Use it | the view is decided, and the views drawn from it are asked whether they still stand | yes, for whatever it stales | the picture it replaced, if nothing chose it |
| Keep previous | the view wears the picture it replaced | no | the picture that was on it |
| Try again | the view is drawn again from the same words | yes, one | nothing: the picture stays in the log |
| Put back (a version) | the view wears an earlier picture; the one it takes off becomes the other side of the decision, and the stage goes to that view | no | nothing |
| The version arrows | nothing at all, it is a look | no | nothing |
| Start over | the conversation begins again from the first question | no | nothing, while anything is drawn: the draft stays on the wall. A draft with no picture on it goes |
| Discard (on the card) | the draft is gone | no | the draft and the pictures nothing else holds |
| Delete (a presenter) | the record is gone, and any session open on it ends | no | the record and the pictures nothing else holds |

Two of them are worth saying in words, because both have been got wrong:

**Put back acts on its own view.** Pressed in the conversation it is about one
view while the stage may be showing another, so the stage goes to the view that
was acted on. Leaving it where it was changed the full body underneath a face
nobody had stopped looking at.

**Put back is a swap, never a verdict.** It leaves the view's status exactly as
it found it, so a picture still waiting to be decided is still waiting, and the
question standing over it is the way on. It settled the view `approved` for one
day, and `nextToDraw` reads approved as "go on", so pressing it started the next
generation before the pictures being chosen between could be stepped through.

**Start over is about the conversation.** Agreeing to begin again never means
destroy what has already been drawn: the draft stays, with everything on it, and
the wall offers it back. A draft nothing was drawn on is not a document and does
go, which is the same line the card's own discard draws, and the dialog says
which side of it this draft is on before the press. Discard on the card is the
destructive act for everything above that line, and asks on its own.

## Changing a person after they are drawn

One decision, in one function (`editIntent`):

- **View-specific.** Repairs the named view. Every other view keeps the picture
  it had.
- **Identity-wide.** Goes to the face. On Use it is recorded as an identity edit
  and rides every later draw, `staleDependents` marks everything built on the
  face stale, and those are drawn again in dependency order. Save is refused
  while anything is stale, so the set cannot be saved half-reconciled.
- **Refused.** A person built from photographs is that person: their views can
  be repaired, their identity cannot be changed. Said while the sentence is
  being written, with where to go instead.

Ambiguous sentences are asked about rather than guessed.

## Draft to saved presenter

One transaction: the append to the brand document and the removal of the draft
row move together, or neither does (`updateBrandAndDropPresenterDraft`). Rejected
candidates and a prior nothing chose are released afterwards; approved views and
the person's own photographs are kept.

A picture-changing edit mints a new record with `revisionOf`/`supersededBy`, so
shots made with the old one still refine against the person they were made with.
A words-only edit patches in place.

A record's own shots that claim no canonical view (a supplementary angle, a
curated `left-profile`, the second and third shots of a legacy record) ride into
the revision **only while the face has not moved**. Nothing stales them, nothing
requires them and nothing checks them against the face, so carrying them through
an identity change saved a person holding a picture of who they used to be, and
`characterRefs` boarded it into a brief beside the new views, all of them under
"match their face exactly".

## After it is saved

The editor is not a continuation of the creation conversation. It opens on the
record, and opening it draws nothing.

## Realtime

This is the studio-wide rule in CONTRIBUTING.md ("Saved changes reach every
surface without a reload"), which scenes and products now follow too. Owned
presenters are read off the brand document the shell holds, so **one
`applyBrand` updates the wall, the page, the ingredient picker and the chips in
the same commit.** Every presenter mutation answers with the brand and applies
it. No surface requires a manual refresh, and **`window.location.reload()` is
never a way of holding state**; there is none in the studio.

Two lists are their own: the wall's drafts and the presenter page's
"a session is open" probe. Both belong to a page whose child route is the thing
that changes them, so both read again on the falling edge of that route rather
than polling.

Deleting a presenter answers with the brand, ends any editing session open on
them, and releases the pictures nothing else holds. A chip in an open brief that
names somebody who is gone says so, and says what to do.

## Async ownership

- Every read and every action carries the draft id it was asked for, and an
  answer about any other draft is refused whatever its clock says (`acceptsDraft`).
- A failure belongs to the draft it was asked about: a 404 for one the page has
  left does not redirect out of the one it is on.
- Nothing autonomous runs while anything is in flight, and a draw counts.
- A step fires once per key, and every flow keeps the whole set of keys it has
  fired rather than the last one.
- One press is one act: the Enter shortcut and the confirm dialog each latch.

## Legacy records

A presenter saved before Studio v2 may have no angle on its shots, no source, no
prose about who it is. All three are read the way the session reads them: an
angle-less first shot is the face, a record with no prose is described by its own
fields, and where it says nothing at all the sentence typed at it becomes its
description. A build that cannot work is not offered. Every picture falls back to
a blank frame rather than the browser's broken glyph.

## Known limits, recorded rather than fixed

Neither is reachable through the studio today. Both are written down so that
whoever makes them reachable solves them first.

**Photographs still say "match their face exactly" after an accepted face
change.** The originals ride as `character` references, and the only thing
resolving the contradiction is one prose fragment saying the drawn views show
the change. Identity edits are refused outright for a person built from
photographs (`presenterEditRules.ts`), so nothing reaches it. Relaxing that
refusal means deciding what the photographs are for first.

**A view seeded from a saved record has no record of what it was drawn from.**
`conditionedOn` is written at draw time only, so `reconcileDependents` cannot
tell a seeded view that a face put back is the one it came with, and stales it.
That costs a generation on a change of mind inside an editing session. It is
conservative in the safe direction: the alternative is a view marked current
while wearing a face nobody used.

## Open, and Tony's to decide

Neither is a defect. Both were found measuring the opening and deliberately
left alone, because they are layout decisions rather than defects and the
transcript's top anchoring is settled doctrine.

**The rail is about half empty at rest** — 441px at 1440x900, 422px at 390x844.
A conversation with two turns in it is genuinely short, and the composer
belongs at the bottom, so this may be the honest shape rather than a gap.

**A phone never sees the promise.** The stage renders as `phone ? null`
(`StudioShell.tsx`), so "First portrait appears here" exists only on a desktop.
On a phone that space says nothing about what the conversation will produce.
The sign itself already exists (`StageEmpty.tsx`), so giving it to the phone is
small; whether it belongs there is the question.

## The 0.10.0 release checklist

Run on the demo engine unless a row says otherwise. Automated coverage in
brackets; a row with none is a manual pass.

**Creation**
- [ ] From scratch, tapped through, to a saved presenter (`create-presenter`)
- [ ] From a typed description (`create-presenter`)
- [ ] From photographs, one and several (`create-presenter`)
- [ ] Photographs nothing could read: stop, say why, draw anyway (`create-presenter-weak-photos`)
- [ ] No engine: the photo is the face, and it saves (`create-presenter-no-engine`)

**Drafts**
- [ ] Create presenter is new however many drafts wait (`presenter-drafts`)
- [ ] Three drafts keep their own answers and pictures (`presenter-drafts`)
- [ ] Continue resumes that draft at its stage (`create-presenter`)
- [ ] Start over begins again and leaves every draft where it was (`presenter-drafts`, `create-presenter`)
- [ ] Discarding drawn work asks; an empty conversation does not (`presenter-drafts`)

**Editing and rewind**
- [ ] An answer three back opens in place and the run carries on (`create-presenter-edits`)
- [ ] A changed answer under a drawn face asks, then redraws (`create-presenter-edits`)
- [ ] Door switch drops the photographs (`create-presenter-edits`)

**The set**
- [ ] View-specific repair leaves every other view alone (`presenter-edit`)
- [ ] Put back steps between pictures and spends nothing (`create-presenter`)
- [ ] A revision drops a picture of the face it replaced (`presenterDrafts`)
- [ ] Identity-wide change reconciles the set before it can be saved (`presenter-edit`)
- [ ] A photographed person cannot be re-identified (`presenterEditRules`)
- [ ] A draw whose face moved lands stale (`presenterDrafts`)

**Saving and the library**
- [ ] Save writes one record and removes the draft (`presenterDrafts`, `core`)
- [ ] A saved presenter appears on the wall and in the picker (`presenter-realtime`)
- [ ] An accepted edit updates the page, the wall and the picker (`presenter-edit`)
- [ ] Delete removes them everywhere with no reload (`presenter-realtime`)
- [ ] Delete ends an open editing session (`presenter-realtime`)
- [ ] A chip naming a deleted presenter says so. Verified by hand 2026-09-16: the
      remedy rides as the chip's `title`, which is the per-chip mark the whole
      composer uses, so on a touch screen the chip reads only "missing person".
      A limit of that pattern, app-wide, not of this surface

**Recovery**
- [ ] Reload mid-draw returns to the same draw (`presenter-recovery`)
- [ ] Leaving mid-draw leaves the work alone (`presenter-recovery`)
- [ ] Reload mid-conversation says nothing twice (`presenter-recovery`)
- [ ] Back and forward across wall, draft and studio (`presenter-recovery`)
- [ ] Refresh during photo analysis. Verified by hand 2026-09-16 on the reload
      path: the photograph is kept, nothing is said twice, the conversation
      resumes at the question it was on. Not verified mid-flight: the demo
      analyzer answers instantly and has no delay knob, so the refresh cannot be
      made to land while the analysis is actually running
- [ ] A failed draw offers Retry and keeps the rest (`create-presenter`)

**Legacy**
- [ ] A pre-v2 record opens, renders and casts (`presenter-legacy`)
- [ ] Its editor claims no changes nobody made (`presenter-legacy`)
- [ ] A record with no prose can still be drawn (`presenter-legacy`)

**The moment it opens**
- [ ] The studio travels over the library, and plays once (`create-presenter`)
- [ ] It says what it will spend, and nothing moves after it lands (`create-presenter`, `create-asset`)
- [ ] On a phone the close is on the screen, thumb-sized, level with the title
- [ ] Reduced motion: it is simply there, with no travel
- [ ] Opening a draft asks nothing it then withdraws, and no picture moves
      (`presenterFlowRules`, `presenter-drafts`)
- [ ] A picture already decoded is at full strength on its first frame

**Responsive and reach**
- [ ] Creation and the editor at 430, 390 and 375. Verified by hand 2026-09-16
      with device emulation, not a resized window: Chrome's macOS window floor
      is about 500px and resizing alone reports a width nobody has
- [ ] Keyboard-only through creation, decision and save. Verified by hand
      2026-09-16, Tab and Enter only, from the first question to the saved
      record; every control carries a visible ring
- [ ] Focus after a dialog and after a destructive action (`presenter-drafts`).
      A confirm opens on Cancel and Escape hands focus back to what opened it.
      A discarded card hands its place to the next card's own discard, because
      the control that discards a card is inside it and agreeing destroys the
      element that had focus

**Before the tag**
- [ ] `pnpm verify` green
- [ ] Full browser suite green on a quiet machine
- [ ] One real Codex battery: a full set, one identity-wide change, one
      view-specific repair, judged for coherence across every view
