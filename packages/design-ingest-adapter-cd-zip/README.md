# @caia/design-ingest-adapter-cd-zip

Claude Design ZIP adapter for `@caia/design-ingest`.

## Status — v0.1.0 SCAFFOLD-ONLY

This package ships as a scaffold:

- `package.json`, `tsconfig`, vitest configs wired
- `CdZipAdapter` class implements `DesignAdapter` with stub
  `validate / parse / refresh` methods that throw `NotImplementedError`
- Minimal fixture under `tests/fixtures/minimal/` for the golden
  harness to point at
- Golden-harness skeleton under `tests/golden/cd-zip.golden.test.ts`
  that fails-fast with a clear "implementation pending" message

**Full implementation lands in a follow-up PR.** See spec
`research/step5_design_ingest_spec_2026.md` §2.1 for the 7-stage
pipeline. The plan is to reuse `@chiefaia/atlas-mapper`'s existing
`parseJsxToRenderableDesign` for the JSX walk rather than write a
fresh Babel walk; the adapter then layers token resolution
(via `postcss`), CLICKS.md/RESPONSIVE.md parsing, shared-component
discovery, and raw-artifact persistence on top.

## Source format

Claude Design ZIP exports unzip to:

```
project/
  README.md
  CLICKS.md
  RESPONSIVE.md
  styles.css
  pages/<route>.jsx
  pages/<route>-mobile.jsx
  assets/
  ...prototype scaffolding (ignored — see §2.1)
```

Required files (validate fails if any missing): `README.md`,
`project/pages/*.jsx`, `project/styles.css`.

Ignore list (verbatim from spec §2.1):

- `prototype.html`, `design-canvas.jsx`, `browser-window.jsx`,
  `tweaks-panel.jsx`, `index.html`, `mobile-pages.jsx`,
  `style-guide.jsx`, `sitemap.jsx`

## Capabilities

```ts
{
  supportsRefresh: false,
  supportsLiveWebhook: false,
  requiresCredential: false,
}
```

CD ZIP is upload-only — `refresh()` throws `RefreshNotSupported`.
