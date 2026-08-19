# Accessibility backlog

**The backlog is empty.** Every accessibility rule Biome ships is enabled at its
recommended severity, `error`, so a new defect fails CI rather than joining a
list. `biome.json` carries no `a11y` block at all, which is the point: there is
nothing to soften.

Reproduce at any time:

```bash
pnpm lint      # biome lint .
pnpm ci        # biome ci . is what CI runs
```

## How this list worked, and how to restart it

The rules used to sit at `"warn"` so CI stayed green while real defects were
worked through, and this file named each one with its file and line. That
backlog is now cleared.

If a batch of genuine defects ever lands again and cannot be fixed in the same
change, the mechanism is unchanged:

1. Downgrade only the specific rule to `"warn"` in `biome.json` under a new
   `a11y` block.
2. List every instance here with file and line, and what the fix is.
3. Fix them, then promote the rule back to `"error"` and delete its section.

Do not reach for that unless the defects are real. The six cases below are not.

## Six documented suppressions, and why they are not defects

Each carries a `biome-ignore` comment naming the rule and the reason, in the
house style used elsewhere in the tree. **Please do not "fix" these**: the
markup is already correct and the rule cannot model the situation.

| File | Rule | Why the rule is wrong here |
|---|---|---|
| `apps/studio/src/layout/Coin.tsx` | `noSvgWithoutTitle` | Decorative gold coin beside a credit figure. It already carries `aria-hidden`, which is the correct treatment; the rule wants a `<title>` regardless. |
| `apps/studio/src/layout/DensityControl.tsx` | `noSvgWithoutTitle` | Same shape: the glyph is `aria-hidden` and the button's own `aria-label` names the density. |
| `apps/studio/src/layout/DensityControl.tsx` | `useSemanticElements` | `role="radio"` on a `<button>`. An `<input type="radio">` cannot carry the sliding pill; a button inside a radiogroup is the idiomatic ARIA pattern. |
| `apps/studio/src/composer/BriefInput.tsx` | `useFocusableInteractive` | The brief is a `contentEditable` div. `contentEditable` **is** focusable; Biome does not model it. |
| `apps/studio/src/composer/BriefInput.tsx` | `useSemanticElements` | It cannot be a `<textarea>`: the brief renders product and scene chips inline. |
| `apps/studio/src/layout/ShowcaseCard.tsx` | `noStaticElementInteractions` | `onMouseLeave` only, dismissing a hover tip. There is no click affordance to expose, and the tips open from their own focusable pills. |

If you disagree with one of these, open an issue rather than a patch, because the
argument is about the pattern, not the line.

## One non-a11y exception, recorded here for want of a better home

`biome.json` turns `style/noDescendingSpecificity` off for
`apps/studio/src/styles/**` only. All 43 instances were in `tokens.css`, a
single 12,000-line stylesheet; Biome offers no autofix, the median distance
between the two rules involved is ~450 lines, and 11 of them sit inside
`@media` blocks where moving a rule changes *when* it applies. The rule's own
documentation calls it a readability heuristic that under-reports. Reordering
that file risks a silent visual regression across every screen for no user
benefit.

The real fix is splitting `tokens.css` into per-component files. Until then the
rule stays live for any other stylesheet and off for that one.
