# @chiefaia/vastu

Private CAIA package. Text → formal page brief → Figma spec → Next.js scaffold pipeline for the CAIA website factory.

> **Option E shape.** Private workspace package, parameterised public API, fixture-corpus tests, project-bonded at runtime via Mentor + Librarian + AGENTS.md. Never published to public npm. See `agent/memory/agent_architecture_shape_2026-05-06.md`.

## Status

Phase 2 (T4.8) — Stage A real implementation landed. Stages B and C remain stubs.

| Stage | Module | Phase | Status |
|---|---|---:|---|
| A — text → formal doc | `src/text-to-doc.ts` | 2 | ✅ real impl (heuristic regex pre-pass + local-LLM-router via Ollama, zero-dollar) |
| B — formal doc → Figma spec | `src/doc-to-figma.ts` | 3 | stub (Stolution port pending) |
| C — Figma spec → scaffold | `src/figma-to-scaffold.ts` | 4 | stub |

### Stage A pipeline

1. Heuristic regex pre-pass extracts URLs, emails, phone numbers, address lines, industry keywords (legal/saas/real-estate/restaurant/etc.) and section keywords (hero/features/pricing/faq/...) from the prose.
2. The hints + raw prose are sent to a local Ollama model via `@chiefaia/local-llm-router` (`forceLocal: true`, `fallbackOnError: false` — zero-dollar gate).
3. The LLM JSON output is validated against `FormalDocSchema` (Zod). On validation failure the call retries ONCE with a simpler prompt + minimal schema, then patches in heuristic + config defaults.
4. A second failure throws `TextToDocLLMError` carrying both raw responses for triage.

`origin` is `'hybrid'` when heuristic signals contributed and `'llm'` otherwise.

## Usage

```ts
import { runVastuPipeline, defaultCaiaVastuConfig, buildVastuConfig } from '@chiefaia/vastu';

const result = await runVastuPipeline({
  inputText: 'A hero with brand-coloured CTA, three feature cards, and a newsletter signup.',
  config: defaultCaiaVastuConfig
});

// result.formalDoc  — typed page brief
// result.figmaSpec  — frame layout + library URLs (FigmaPagePayload-shaped)
// result.scaffold   — { files: [{ path, contents }], notes } ready to materialise
```

Per-site override:

```ts
const result = await runVastuPipeline({
  inputText: '...',
  config: buildVastuConfig({
    brandVoice: { tone: 'playful', audience: 'roulette enthusiasts' },
    palette: { primary: '#dc2626', /* ... */ }
  })
});
```

## CAIA bonding

The package is parameterised but the **default** values are bonded to CAIA's website factory:

- `scaffoldTargetTemplate: 'templates/site'` — the canonical CAIA site template
- `defaultSectionHeight: 320`, `desktopWidth: 1440` — CAIA design conventions
- `libraryUrls.{basic,business,blueprints}` — placeholder URLs replaced when ops sets up CAIA's L1-L4 Figma libraries (Phase 3)
- `allowFigmaWrite: false` — dry-run only until ops opens it (zero-dollar gate)

Project-bonding at runtime is delivered by the Mentor + Librarian pre-spawn pipeline (already in place across the CAIA agent fleet) — this package consumes that context, it does not roll its own.

## Public API

| Export | Purpose |
|---|---|
| `runVastuPipeline({ inputText, config, ... })` | Entry — composes Stages A-C |
| `textToDoc({ inputText, config, pageId? })` | Stage A direct call |
| `docToFigma({ formalDoc, config })` | Stage B direct call |
| `figmaToScaffold({ figmaSpec, config })` | Stage C direct call |
| `defaultCaiaVastuConfig` | CAIA-bonded defaults |
| `buildVastuConfig(overrides)` | Default + override merge |
| `VastuConfigSchema` | Zod schema for runtime validation |

## Tests

```bash
pnpm --filter @chiefaia/vastu test
```

Tests use `tests/fixtures/mock-config.ts` — never live CAIA paths (Option E gate #3).

## Roadmap

- **Phase 2** — `text-to-doc.ts`: heuristic + LLM via `@chiefaia/local-llm-router`.
- **Phase 3** — `doc-to-figma.ts`: lift Stolution `@stolution/vastu-figma-bridge` (`generate.ts`, `component-map.ts`, `layout.ts`, `approvals.ts`) parameterised against `VastuConfig`.
- **Phase 4** — `figma-to-scaffold.ts`: real Next.js generator + `caia new site --vastu-from <text|file>` wiring in `packages/cli/src/commands/new.ts`.

Source pattern + research: `agent/memory/stolution_caia_text_to_design_pipeline_2026-05-07.md`. Phase 1 design: `agent/memory/vastu_caia_port_design_2026-05-08.md`.
