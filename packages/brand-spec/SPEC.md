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
  "extensions": {}
}
```

## Design rules

1. **Everything optional except `specVersion` and `meta.name`.** A `.brand` built in 30 seconds from a URL scrape is valid; richness accretes.
2. **`locked: true` on product shots** signals generators/editors that this asset's pixels are fidelity-critical — the contract behind drift-diff.
3. **Prose fields are prompts.** `usage`, `rules`, `mood`, `notes` are free text intended to be injected into generation context verbatim — human-readable and machine-usable.
4. **`extensions`** is a namespaced escape hatch (`"com.example.tool": {...}`); tools must ignore unknown namespaces. Spec evolution via RFC issues, additive-only within 0.x.
5. **No secrets.** A `.brand` must always be safe to email to a client. Keys, tokens, and provider config live in the tool, never the format.

Machine-readable schema: [`schema/brand.schema.json`](schema/brand.schema.json). Reference validator: `validateBrand(json)` in this package, which ships inside the `scenri` CLI rather than as its own npm package. The schema and this spec are Apache-2.0, so implement them however you like. If you are building a tool that needs the validator on npm, open an issue and it will be published.
