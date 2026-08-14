# The `.brand` Format — Specification v0 (draft)

**License of this spec + schema: Apache-2.0** (deliberately permissive — any tool may implement it).
Status: draft for RFC. Version field: `specVersion: "0.1"`.

## What it is

A portable, tool-neutral description of a brand's visual and verbal identity — enough for an AI generation tool to produce on-brand assets without re-teaching the brand every time. Think `package.json` for brand DNA.

## Container

- **Bare form:** a `brand.json` file, asset fields hold URLs or paths relative to the JSON file.
- **Bundle form:** a `.brand` file = ZIP containing `brand.json` + `assets/` (logos, style references, product shots). Bundle is the interchange form designers send to clients and tools.

## Top-level shape (`brand.json`)

```json
{
  "specVersion": "0.1",
  "meta": {
    "name": "Acme Coffee",
    "slug": "acme-coffee",
    "tagline": "Slow mornings, fast espresso",
    "industry": "food-and-beverage",
    "website": "https://acme.coffee",
    "createdWith": "scenri/0.1.0",
    "updatedAt": "2026-08-01T00:00:00Z"
  },
  "palette": {
    "primary":   { "hex": "#1F3D2B", "name": "Forest" },
    "secondary": { "hex": "#E8DCC8", "name": "Oat" },
    "accent":    [ { "hex": "#D96C3B", "name": "Terracotta" } ],
    "neutrals":  [ { "hex": "#111111" }, { "hex": "#FAFAF7" } ],
    "usage": "Forest dominates packaging; terracotta only for CTAs and highlights."
  },
  "typography": {
    "display": { "family": "Canela", "weights": [500], "fallback": "serif" },
    "body":    { "family": "Inter", "weights": [400, 600], "fallback": "sans-serif" },
    "rules": "Display serif for headlines only; never set body copy in Canela."
  },
  "logos": [
    { "role": "primary", "file": "assets/logo-primary.svg", "background": "light", "clearSpace": "1x logo height" },
    { "role": "mark",    "file": "assets/logo-mark.svg",    "background": "any" }
  ],
  "imagery": {
    "styleReferences": [
      { "file": "assets/ref-01.jpg", "note": "hero lighting: warm, directional, 35mm grain" }
    ],
    "keywords": ["warm daylight", "natural textures", "shallow depth of field"],
    "avoid": ["neon", "corporate stock poses", "pure white studio backgrounds"],
    "mood": "crafted, unhurried, tactile"
  },
  "rules": {
    "never": ["competitor logos in frame", "visible text on garments"],
    "notes": "Packaging is always shown upright and unopened."
  },
  "voice": {
    "tone": ["warm", "dry-witted", "plainspoken"],
    "avoid": ["exclamation marks", "hype adjectives"],
    "sampleLines": ["Espresso for people with somewhere to be. Eventually."]
  },
  "products": [
    {
      "id": "flagship-bag",
      "name": "House Blend 250g",
      "shots": [ { "file": "assets/product-bag-front.png", "angle": "front", "locked": true } ],
      "notes": "Label artwork must never be altered — lock pixels in edits."
    }
  ],
  "characters": [
    {
      "id": "up-8f2c41ab",
      "name": "Mara",
      "promptName": "a woman in her early thirties with dark shoulder-length waves",
      "presentation": "woman",
      "descriptor": "Warm editorial · dark waves · composed",
      "ageRange": "early 30s",
      "hair": "dark shoulder-length waves",
      "identityNotes": "the wide-set brown eyes and the small scar above the left brow must survive every generation",
      "negativeConstraints": ["no straightened hair", "no youth-smoothing"],
      "sourceRefs": [ { "file": "assets/mara-photo-01.png" } ],
      "shots": [ { "file": "assets/mara-front.png", "angle": "front", "locked": true } ],
      "origin": "custom"
    }
  ],
  "scenes": [
    {
      "id": "us-3ab90c17",
      "name": "Wet Basalt Shore",
      "lighting": "Low directional sunset, long shadows across wet stone",
      "description": "A dark volcanic shoreline at last light, sea haze softening the horizon.",
      "subject": "product",
      "prompt": "A wet dark basalt shelf at low sunset light, foreground rock occluding the lower frame, cool atmospheric ocean haze behind, cinematic depth.",
      "collections": ["Editorial"],
      "verticals": ["Beauty"],
      "keywords": ["volcanic", "shore", "sunset", "wet stone"],
      "refs": [ { "file": "assets/scene-us-3ab90c17-ref-01.png" } ],
      "preview": "assets/scene-us-3ab90c17-preview.png",
      "width": 1024,
      "height": 1280
    }
  ],
  "extensions": {}
}
```

## Design rules

1. **Everything optional except `specVersion` and `meta.name`.** A `.brand` built in 30 seconds from a URL scrape is valid; richness accretes.
2. **`locked: true` on product shots** signals generators/editors that this asset's pixels are fidelity-critical — the contract behind drift-diff.
3. **Prose fields are prompts.** `usage`, `typography.rules`, `mood`, `rules.notes` and `notes` are free text
   intended to be injected into generation context verbatim — human-readable and machine-usable.
   `rules` is the brand's standing law: `never` holds short prohibitions and `notes` free prose, and both
   apply to every generation unless a tool offers an explicit off-brand escape.
4. **`extensions`** is a namespaced escape hatch (`"com.example.tool": {...}`); tools must ignore unknown namespaces. Spec evolution via RFC issues, additive-only within 0.x.
5. **No secrets.** A `.brand` must always be safe to email to a client. Keys, tokens, and provider config live in the tool, never the format.
6. **A scene is a place, not a picture.** `scenes[].prompt` describes the reusable world — environment, materials, light, atmosphere — and never names the product, brand or person staged in it (the schema rejects a `{product_name}` placeholder outright). `scenes[].refs` are the human's inspiration images, kept for display and provenance: a scene contributes text to a generation, never pixels, so a reference that happens to contain someone else's product or model can never leak into a render through it.
7. **Identity evidence outranks anything generated from it.** `characters[].sourceRefs` holds the photos a person was built from; `characters[].shots` may hold normalized views derived from those. A tool may regenerate `shots`; it must never overwrite `sourceRefs`, and must not present a generated view as more authoritative than the evidence.
8. **`promptName` is frozen, `name` is free.** Where both exist, generators read `promptName` and humans read `name`. Without it a record is named to the generator by `name`, which makes renaming a generation change — so tools that let people rename should write a `promptName` at creation.

### Changelog

- **0.1 draft, 2026-08:** added `scenes[]`, and `promptName` / `presentation` / `descriptor` / `ageRange` / `hair` / `identityNotes` / `negativeConstraints` / `sourceRefs` / `preview` / `avatar` / `origin` to `characters[]`. Additive within the draft — no `specVersion` bump — but a bundle using them will fail validation against an older 0.1 validator.

Machine-readable schema: [`schema/brand.schema.json`](schema/brand.schema.json). Reference validator: `validateBrand(json)` in this package, which ships inside the `scenri` CLI rather than as its own npm package. The schema and this spec are Apache-2.0, so implement them however you like. If you are building a tool that needs the validator on npm, open an issue and it will be published.
