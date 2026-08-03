# Accessibility backlog

Every item below is a real accessibility defect that Biome currently reports as a **warning** rather than an error, so CI stays green while they are worked through. They are not suppressed and not exceptions: each one is a small, well-scoped fix, which makes them good first contributions.

Reproduce the current list at any time:

```bash
pnpm lint
```

When an item is fixed, promote its rule back to `"error"` in `biome.json`. When a whole rule's list is empty, delete the rule's line from the `a11y` block so the recommended default (error) applies again.

## `noLabelWithoutControl` (11)

A `<label>` that is not tied to a form control announces nothing to a screen reader and does not focus the input when clicked. Fix by giving the control an `id` and the label a matching `htmlFor`, or by nesting the control inside the label.

| File | Line |
|---|---|
| `apps/studio/src/layout/Inspector.tsx` | 194, 213, 225, 237, 249, 261, 283 |
| `apps/studio/src/views/BrandSetup.tsx` | 190, 224, 284, 292 |

The seven in `Inspector.tsx` are the same property-grid row repeated, so fixing one likely fixes all seven.

## `useKeyWithClickEvents` / `useFocusableInteractive` / `useSemanticElements` / `noStaticElementInteractions` (8)

A `<div>` carrying `onClick` cannot be reached by keyboard and is invisible to assistive tech. The best fix is almost always to make it a real `<button type="button">` and let the browser supply focus, Enter and Space. Where the element must stay a `div`, it needs `role`, `tabIndex={0}` and a keyboard handler.

| File | Line | Rule |
|---|---|---|
| `apps/studio/src/layout/Inspector.tsx` | 171 | `useFocusableInteractive`, `useKeyWithClickEvents` |
| `apps/studio/src/layout/Inspector.tsx` | 173 | `useSemanticElements` |
| `apps/studio/src/composer/BriefInput.tsx` | 486 | `useFocusableInteractive` |
| `apps/studio/src/composer/BriefInput.tsx` | 491 | `useSemanticElements` |
| `apps/studio/src/views/Looks.tsx` | 114 | `useKeyWithClickEvents`, `noStaticElementInteractions` |
| `apps/studio/src/editor/TextOverlayEditor.tsx` | 131 | `noStaticElementInteractions` |

`BriefInput.tsx` needs care: it is a `contenteditable` composer with its own caret handling, and the composer has Playwright coverage in `apps/studio/e2e/composer.spec.ts`. Run that suite against any change there.

## `noAutofocus` (3)

`autoFocus` moves focus on mount without warning, which disorients screen reader and magnifier users and can scroll the page unexpectedly. Prefer focusing deliberately with a ref inside an effect, when the surface is actually ready.

| File | Line |
|---|---|
| `apps/studio/src/editor/TextOverlayEditor.tsx` | 152 |
| `apps/studio/src/views/BrandSetup.tsx` | 195, 229 |

## `noSvgWithoutTitle` (1)

An inline `<svg>` with no accessible name is announced as nothing. Add a `<title>` child, or `aria-hidden="true"` if the graphic is purely decorative and the meaning is carried by adjacent text.

| File | Line |
|---|---|
| `apps/studio/src/layout/Coin.tsx` | 4 |

This one is decorative next to a credits figure, so `aria-hidden` is very likely the right call. Smallest possible first contribution.
