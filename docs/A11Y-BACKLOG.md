# Accessibility backlog

**The backlog is empty.** Every accessibility rule in Biome's recommended set
runs at its recommended severity, `error`, so a new defect fails CI rather than
joining a list. `biome.json` carries no `a11y` block at all, which is the point:
there is nothing to soften. (One a11y rule sits outside the recommended set,
`noNoninteractiveElementInteractions`, and is not enabled.)

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

Do not reach for that unless the defects are real. The seventeen cases below are not.

## Seventeen documented suppressions, and why they are not defects

Each carries a `biome-ignore` comment naming the rule and the reason, in the
house style used elsewhere in the tree. **Please do not "fix" these**: the
markup is already correct and the rule cannot model the situation.

| File | Rule | Why the rule is wrong here |
|---|---|---|
| `apps/studio/src/layout/DetailOverlay.tsx` | `useSemanticElements` | A window splitter must be focusable, which an `<hr>` cannot be; ARIA's separator-as-widget pattern is exactly a focusable element carrying `aria-valuenow`. |
| `apps/studio/src/create/studio/StudioFrame.tsx` | `useSemanticElements` | The same splitter pattern, in the studios. |
| `apps/studio/src/layout/ChipField.tsx` | `noStaticElementInteractions` | A pointer shortcut onto the hit button underneath, which is the real, focusable menu trigger. |
| `apps/studio/src/layout/ChipField.tsx` | `useKeyWithClickEvents` | The keyboard reaches the same menu through that hit button, so a key handler here would be a second route. |
| `apps/studio/src/layout/ShowcaseCard.tsx` | `noStaticElementInteractions` | `onMouseLeave` only, dismissing a hover tip. There is no click affordance to expose, and the tips open from their own focusable pills. |
| `apps/studio/src/layout/DensityControl.tsx` | `useSemanticElements` | `role="radio"` on a `<button>`. An `<input type="radio">` cannot carry the sliding pill; a button inside a radiogroup is the idiomatic ARIA pattern. |
| `apps/studio/src/composer/BriefInput.tsx` | `useSemanticElements` | It cannot be a `<textarea>`: the prompt renders product and scene chips inline. |
| `apps/studio/src/composer/BriefInput.tsx` | `useAriaPropsSupportedByRole` | A textbox plus a listbox is the caret-menu pattern; switching to `combobox` drops `aria-multiline`. |
| `apps/studio/src/composer/IngredientPicker.tsx` | `noStaticElementInteractions` | A key router, not a control. |
| `apps/studio/src/composer/ColorChipMenu.tsx` | `noStaticElementInteractions` | A key router, not a control. |
| `apps/studio/src/composer/attach/AttachBody.tsx` | `noStaticElementInteractions` | A key router, not a control. |
| `apps/studio/src/composer/shotSettings/Choices.tsx` | `useSemanticElements` | A native radio cannot carry the shape swatch, the name and the ratio as one hit target, and its own dot would be a second selected-state beside the row's lift. |
| `apps/studio/src/views/Create.tsx` | `useKeyWithClickEvents` | The keyboard path is Escape, bound on the document, so a key handler here would be a second route to the same clear rather than a missing one. |
| `apps/studio/src/views/Products.tsx` | `useKeyWithClickEvents` | The same: Escape, bound on the document, is the keyboard path to the same clear. |
| `apps/studio/src/views/Presenters.tsx` | `useKeyWithClickEvents` | The same: Escape, bound on the document, is the keyboard path to the same clear. |
| `apps/studio/src/views/Scenes.tsx` | `useKeyWithClickEvents` | The same: Escape, bound on the document, is the keyboard path to the same clear. |

If you disagree with one of these, open an issue rather than a patch, because the
argument is about the pattern, not the line.

## One non-a11y exception, recorded here for want of a better home

`biome.json` turns `style/noDescendingSpecificity` off for
`apps/studio/src/styles/**` only. In that tree, import order is the cascade on
purpose: `styles/app.css` is an ordered `@import` manifest where later files
deliberately override earlier ones, and the `styles/overrides/` files are
chained passes that exist to win. The rule is a readability heuristic that
flags exactly that intent as a mistake. It stays live for any other stylesheet,
and the visual-regression suite (`pnpm test:visual`) guards the pixels the rule
is worried about.
