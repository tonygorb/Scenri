# @scenri/brand

The `.brand` format: a portable, tool-neutral description of a brand's visual and verbal
identity, built so an AI generation tool can produce on-brand assets without re-teaching
the brand every time.

- [SPEC.md](SPEC.md) is the specification: the container forms, a full annotated example,
  and the eight design rules.
- [schema/brand.schema.json](schema/brand.schema.json) is the machine-readable JSON Schema.
- `validateBrand(json)` in this package is the reference validator. It ships inside the
  `scenri` CLI rather than as its own npm package; if you are building a tool that needs it
  on npm, open an issue and it will be published.

Two forms. A bare `brand.json`, or a `.brand` bundle, which is a ZIP holding `brand.json`
plus an `assets/` folder. The bundle is the interchange form designers send to clients and
tools. A `.brand` never carries credentials, so it is always safe to email.

The spec and schema are licensed [Apache-2.0](LICENSE), deliberately more permissive than
the AGPL application around them, so any tool may implement or adopt the format without
taking on copyleft. Status: v0 draft, evolving through RFC issues, additive-only within
`0.x`.
