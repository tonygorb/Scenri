# Presenter Studio v2: what the hardening pass found, and what it did not

Written 2026-09-16 at the end of the 0.10.0 hardening pass on
`feat/presenter-studio-v2` (PR #184). It separates three things that a single
readiness number would blur together: defects in the architecture, limits of
the model, and parts of the space nobody has looked at. There is no single
score here on purpose.

The checklist this is measured against is at the end of
`docs/presenter-lifecycle.md`.

## 1. Architecture defects, found and fixed

Each was proved red before its fix and is pinned by a test that fails without
it.

| What was wrong | Why it mattered | Where |
|---|---|---|
| Two brand-scoped session keys decided which conversation was open | Create presenter reopened a draft from two days ago with its face already drawn. The reported bug | `useCreationFlow`, now keyed by `location.key` |
| Put back settled the view `approved` | `nextToDraw` reads approved as "go on", so putting a picture back started the next generation and the pictures being chosen between could not be stepped through | `restoreView` |
| `approveView` read "holds a prior" as "the face moved" | True of every redraw. Putting a face back and using it marked every dependent stale and drew them again from the picture they already stood on | `approveView`, now `reconcileDependents` |
| `keptShots` rode into every minted revision unread | A person whose identity changed could be saved carrying a picture of who they used to be, and `characterRefs` boarded it into a brief under "match their face exactly" | `saveEdit` |
| Start over deleted the draft | A half-built set with a face and a full body went with one agreed dialog | `useCreationFlow`, now gated on `worthKeeping` |
| A view repair could not win over the clauses its own subject pins | Every non-face subject says "their own hair exactly as the attached images show it", so a repair naming hair asked for one thing and was told the opposite in the same breath | `planStep` |
| The question over a picture put back called it a redraw | Of a face put back to the one before an identity change it said "Here is her with the change", the opposite of what happened | `presenterRecordTurns` |
| A discarded draft dropped focus to the body | The control that discards a card is inside it, so agreeing destroyed the element that had focus and the next Tab began again at Skip to content | `Presenters.tsx` |

Nine further defects were found and fixed that were never reported: a
no-engine dead end, a stale-draw race, a seed latch on a drawing draft, delete
propagation, save atomicity, four legacy-record defects and a double-submit.

## 2. Model fidelity: what real pixels say

Two Codex batteries, 2026-09-16.

**Holds.** A full set drawn from one description came back as one person across
face, full body and three-quarter. An identity-wide change (a chin-length bob)
staled both dependents, they were drawn again, and all three views came back
the same woman with the new hair. A view-specific repair left the face and the
full body byte-identical.

**The new prompt holds too.** A repair naming the hair ("sweep her hair back
behind both shoulders") moved the hair and nothing else: same face, same build,
same uniform, same framing, and the canonical portrait untouched. That is the
override sentence working, and it is the one thing the demo engine could never
have answered.

**Sizes agree.** Every picture in both batteries is 1122x1402. The one
odd-sized image reported on 2026-09-15 was a bad draw, not a code path;
redrawing it returned the standard size.

**What is not known.** One sample per behaviour. Identity drift across a long
chain (`right` is three hops from the portrait) has been reasoned about and not
measured, because each measurement costs a generation and the weekly pool
finished this pass at 8 percent. It is recorded as a surface to watch rather
than fixed speculatively.

## 3. Declined, with reasons

- **A semantic scope model** (FACE / HAIR / BODY / TRAIT deciding which views a
  change can reach). Deciding that a nose change cannot reach the Back view
  means predicting what is visible in a picture, from a sentence, with no
  vision. Being wrong leaves an old-identity view marked current, which is the
  exact incoherence the rule exists to prevent. Redrawing one view too many
  costs a generation; misclassifying costs correctness.
- **Snapshot-pinned parallel reconciliation.** The chain re-reading live hashes
  is the graph working as designed, and the battery showed no drift across a
  full reconciliation.

## 4. Known limits, recorded rather than fixed

Neither is reachable through the studio today.

- **Photographs still say "match their face exactly" after an accepted face
  change.** Identity edits are refused outright for a person built from
  photographs, so nothing reaches it. Relaxing that refusal means deciding what
  the photographs are for first.
- **A view seeded from a saved record has no `conditionedOn`**, so a face put
  back inside an editing session stales its dependents even when it is the one
  they came with. Costs a generation on a change of mind. Conservative in the
  safe direction.

And one that is reachable: **a chip for a deleted presenter carries its remedy
as a `title`**, which no touch screen can reach. That is the per-chip mark the
whole composer uses, so it is a limit of that pattern, app-wide, not of this
surface.

## 5. Why the suite could not see any of this

This is the part worth keeping.

**A presenter draw was instant in every spec.** `SCENRI_DEMO_STAGGER_MS` waits
*between* pictures and a presenter draw asks for one, so it never slowed a draw
at all. `presenter-recovery` carried `STAGGER_MS: 4000` and it did nothing.
Every spec watched each view land in the frame the press landed in, and so
tested none of the states a person actually sits in. Three of the four defects
reported by hand lived in exactly that gap. `SCENRI_DEMO_DELAY_MS` now delays
the first picture too, and three specs run at 400ms.

**A red test was rewritten to match the code.** `c63a1fd` turned
"the pictures of a view are stepped through while nothing is built on it" red,
and the assertion was changed to accept the generation that now fired, with a
confident comment explaining why that was correct. It was the alarm for the Put
back bug, which was hit by hand within the hour. The rule is now in the
`conversation-flow` skill: never rewrite a red test to match the code, and if a
test's claim really is out of date, change its name and its words first and let
the assertion follow.

**The checklist's own hand rows had never been run.** Responsive, keyboard and
focus carried no automated coverage and nobody had done them. Running them
found the focus defect in the first ten minutes.

## 6. The opening, done after the rest

Added 2026-09-16, after the hardening pass, from the one question it had left
open: whether the moment after Create presenter could be better.

It could, and the finding was not "there is no animation". The conversation
inside was already paced to the millisecond while the room around it was
slammed at full opacity on frame one, with no animation, no transition and no
start state. The studio was the only surface for making a new thing with no
arrival, despite already borrowing that family's header class.

It now uses the house motion, per form factor, on the house curve: the same
keyframes `add-to-brand` uses. A first pass faded instead, which is what you
reach for when you have not decided what the motion means.

Measuring it turned up two defects that had nothing to do with motion:

- **The composer moved 35px at about 400ms**, because the footnote said
  "Checking the engine..." and then unmounted when the capabilities probe
  answered, while the first question was still being spoken.
- **The close on a phone head ran 2px off the screen** and was clipped there,
  sat 20px in against the title's 16, and centred 2.5px above the middle of
  the bar. One rule with four different padding values.

And one false green. `create-asset.spec.ts` claims each flow says what pressing
its button will do; the presenter studio passed `capsNote('')` and never said
anything, so that assertion had only ever been catching the transient loading
line. The first fix silenced the line, which would have made the false green
permanent. The right fix was the opposite: say what it spends, like the other
two flows do. The 35px jump then goes as a consequence rather than as the goal.

That is the rule from section 5 working on its author within a day of it being
written down.

## 7. Where it stands

- `pnpm verify` green. Full browser suite green on a quiet machine.
- 34 of 40 checklist rows green by automation; the 6 hand rows run on
  2026-09-16, two of them with the caveats recorded in §4.
- Two things in this report are one-sample claims, both in §2, and both say so.
