# Scaffold templates — caia/packages/ survey

**Generated:** 2026-05-16 by `stolution-caia-package-survey` chain (phase 1 of 1).
**Source branch:** `develop` (commit at branch-point: see `git log`).
**Total packages surveyed:** 74.

## Purpose

Each `<package-name>.yaml` is a **structured stub** capturing the *typical*
work shape for that package. The downstream **v2-templated-scaffolder**
reads these stubs and emits chain-runner specs with zero LLM tokens — the
scaffolder only substitutes `<feature>` placeholders, dep IDs, and the
specific demonstrate-step verb the operator asks for.

Template schema mirrors the existing
`reports/v2_backlog_structured_items/*.yaml` shape (one canonical example:
`SPS-B5.yaml`), with two added fields:

| Field             | Purpose                                              |
|-------------------|------------------------------------------------------|
| `id`              | `PKG_<UPPER_SNAKE>` — stable handle the scaffolder substitutes per item. |
| `title`           | Human-readable label.                                 |
| `description`     | Survey-line + scaffolder instructions.                |
| `machine`         | `m3` (caia code) or `stolution` (long batch).         |
| **`state`**       | `live` / `lightly-integrated` / `dormant`.            |
| **`importers_seen`** | In-repo importer count at survey time (audit-trail). |
| `file_paths`      | Typical files touched. Contains `<feature>` placeholders. |
| `success_criteria.output_file` | Report path; contains `<feature>` placeholder. |
| `success_criteria.min_bytes`   | Minimum acceptable report size.                 |
| `success_criteria.grep_match`  | Regex the report must satisfy.                  |
| `requires_merged_pr` | `true` for code work, `false` for analysis-only items. |
| `phase_count`     | Typical chain depth (1 / 2 / 3).                      |
| `deps`            | Always empty in the template — scaffolder fills.      |
| `demonstrate_step`| Archetype-specific proof line.                        |

`machine` routing rule:
- **stolution** — long batch / corpus scan / embedding refresh / eval suite / GPU / daemon lifecycle.
- **m3** — pure TS-library work, unit tests, type changes, small refactors.

`state` derivation:
- `live` — ≥ 2 in-repo importers found at survey time.
- `lightly-integrated` — exactly 1 importer (load-bearing risk: bus-factor 1).
- `dormant` — 0 importers found; either newly extracted, slated for archive, or never wired in.

## Summary counts

| Bucket                 | Count | % of fleet |
|------------------------|-------|------------|
| **Total packages**     | 74    | 100%       |
| `machine: m3`          | 41    | 55%        |
| `machine: stolution`   | 33    | 45%        |
| `state: live`          | 27    | 36%        |
| `state: lightly-integrated` | 2 | 3%         |
| `state: dormant`       | 45    | 61%        |

Cross-reference with `docs/DORMANT_PACKAGES.md` (probe-driven, 41 dormant):
the survey's "dormant" set is **slightly larger** (45) because the probe's
`Last importer seen` field treats certain internal-only packages as live
via plist-backed CLI bins. The survey only counts grep'd import sites in
`packages/ apps/ services/`. The deltas are:

| Package | Probe says | Survey says | Why mismatch |
|---|---|---|---|
| `chain-runner`         | live (plist-bound bins) | dormant (0 grep importers) | Used via CLI only. |
| `cli`                  | live (plist-bound)      | dormant                    | Same — CLI entry-point. |
| `local-llm-router-py-client` | dormant            | dormant                    | Match. |
| `dev-inspector`        | dormant                 | dormant                    | Match. |
| `event-bus-internal`   | not listed              | live (19 importers)        | Genuinely live. |
| `events-taxonomy-internal` | not listed          | live (6 importers)         | Genuinely live. |
| `mentor-event-bus`     | dormant per probe       | live (17 importers)        | Probe semantics confusion — probe means "no audit-jsonl invocations in 7d," NOT "no source-tree importers." This package is heavily imported. |
| `claude-spawner`       | dormant per probe       | live (21 importers — fresh D1 sweep) | Probe is stale; D1 just landed. |

## Full package classification

Sorted by `state` then descending importer count.

### Live (≥ 2 importers) — 27 packages

| Package | machine | importers | typical demo |
|---|---|---|---|
| ticket-template          | m3        | 82 | zod-validate |
| logger                   | m3        | 27 | structured-log |
| claude-spawner           | stolution | 21 | spawn-smoke |
| local-llm-router         | stolution | 21 | daemon-smoke |
| event-bus-internal       | m3        | 19 | event-emit |
| feature-registry         | m3        | 18 | registry-query |
| mentor-event-bus         | stolution | 17 | event-emit |
| agent-contract-registry  | m3        | 12 | registry-query |
| architecture-registry    | m3        | 10 | registry-query |
| capability-broker        | m3        |  7 | token-mint |
| classifier               | m3        |  7 | classify-eval |
| hmac-auth                | m3        |  6 | signed-request |
| events-taxonomy-internal | m3        |  6 | event-emit |
| events                   | m3        |  5 | event-emit |
| prompt-optimizer         | m3        |  5 | optimize-prune |
| spend-guard              | m3        |  4 | spend-pause |
| apprentice-corpus        | stolution |  3 | corpus-build |
| apprentice-serving       | stolution |  3 | ollama-swap |
| dspy-bridge              | stolution |  3 | python-bridge |
| librarian                | stolution |  3 | precedent-retrieval |
| mcp-allowlist-proxy      | stolution |  3 | daemon-smoke (allowlist proxy) |
| mentor-retrieval         | stolution |  3 | embed-index |
| decomposer               | m3        |  2 | hierarchy-decompose |
| dedup-engine             | m3        |  2 | jaccard-dedup |
| errors                   | m3        |  2 | throw-catch |
| secrets                  | m3        |  2 | secret-read |
| tool-output-sanitizer    | m3        |  2 | sanitize-eval |

### Lightly-integrated (1 importer) — 2 packages

| Package | machine | importers | risk |
|---|---|---|---|
| claude-subagents | stolution | 1 | bus-factor-1; load-bearing if the single importer is the spawner |
| vastu            | m3        | 1 | bus-factor-1; pipeline component |

### Dormant (0 importers) — 45 packages

| Package | machine | reason for dormancy (best guess) |
|---|---|---|
| aiml-architect              | m3        | New architect-agent skeleton — never wired |
| analytics                   | stolution | Built for poker/roulette sites — sites not yet adopted |
| apprentice-eval             | stolution | Phase 1 of Apprentice; gated on training output |
| apprentice-retrainer        | stolution | Cron-only; not invoked yet |
| apprentice-training         | stolution | Phase 2; gated on corpus |
| backend-core                | stolution | poker/roulette Supabase shared backend — not in monorepo yet |
| behavior-suite              | stolution | Test framework for sites — sites not building |
| cast-bridge                 | stolution | TabMirror utility — no host page yet |
| chain-runner                | stolution | CLI-invoked, not source-imported (probe disagrees, see above) |
| cli                         | m3        | CLI-only — invoked via bin, not imported |
| code-reviewer               | m3        | Review-sibling; not yet spawned by spawner |
| config                      | m3        | Available, but consumers still use ad-hoc env reads |
| content-engine              | stolution | poker/roulette — gated on site readiness |
| critic                      | m3        | Review-sibling; not yet spawned |
| curator                     | stolution | Daily cron — cron not enabled |
| dead-shell-detector         | m3        | One-shot CLI — not imported |
| decomposer-recursive        | m3        | Recursive PO decomposition — gated on PO Agent wiring |
| dev-inspector               | m3        | Browser-side; not yet bundled into a host app |
| guardrails-validator        | m3        | Validator layer — not yet wired into router call sites |
| image-provider              | stolution | Site-side dependency |
| integrity-check             | stolution | Site-side dependency |
| llm-cache                   | stolution | L6 preset exists but cascade-escalation.ts hasn't wrapped calls (per LAI-A2 backlog) |
| local-llm-router-mcp        | stolution | MCP server stub — not registered with any MCP client |
| local-llm-router-py-client  | stolution | Python client — Cowork side not built |
| local-rag                   | stolution | Embedding index not built; gated on retrieval consumer |
| mentor-fastpath             | stolution | Phase 1 reactive path — postmerge watcher not enabled |
| metrics                     | m3        | Prom scrape not configured for non-router services |
| orchestrator-elevate        | stolution | sudo wrapper — not deployed (P0 docs only) |
| playwright-config           | m3        | Factory — consumers (Fix-It Test Agent) not wired |
| prompt-evals                | stolution | Promptfoo suite — eval cron not enabled |
| researcher                  | stolution | Spawned-agent shape; not yet on the spawner's allowlist |
| reviewer                    | m3        | Review-sibling; not yet spawned |
| secrets-broker              | m3        | Broker side; consumers still use `secrets` client direct |
| seo-program                 | stolution | Site-side dependency |
| skills-registry             | m3        | Registry exists; agent self-registration not wired |
| steward-analyzers           | m3        | Static analyzers — propose-only, not on PR gate yet |
| steward-core                | m3        | DevOps Steward — process-graph not active on prod merges |
| stolution-dispatch          | stolution | MCP tool — not registered with any MCP client |
| story-decomposer            | m3        | PO Agent component — gated on PO Agent wiring |
| surface                     | m3        | Operator-curation lens — daily scan not enabled |
| system-prompt-block         | m3        | Primer block ready; spawner doesn't yet prepend it |
| test-isolation              | m3        | Test framework — consumers haven't adopted |
| test-kit                    | m3        | Fixture lib — consumers haven't adopted |
| tracing                     | m3        | OTEL ready; collector not deployed |
| verifier                    | stolution | Review-sibling; not yet spawned |

## Scaffolding-priority bands

Priority is **how soon the v2-templated-scaffolder will benefit from this
template being polished**. Heuristic = importer-count × work-recency ×
operator-attention-signal (DORMANT_PACKAGES.md cohort).

### HIGH (15 packages)
Hot live packages — most chain-runner items today touch these:

  logger, ticket-template, local-llm-router, mentor-event-bus,
  claude-spawner, feature-registry, event-bus-internal, hmac-auth,
  capability-broker, classifier, agent-contract-registry,
  architecture-registry, spend-guard, prompt-optimizer,
  tool-output-sanitizer.

### MED (20 packages)
Either lightly-used live, or dormant-but-on-the-near-term-wiring-wave
(per `docs/DORMANT_PACKAGES.md` disposition + the LAI-A/IR-C wave in the
v2 backlog):

  apprentice-corpus, apprentice-serving, dspy-bridge, librarian,
  mcp-allowlist-proxy, mentor-retrieval, decomposer, dedup-engine,
  errors, secrets, events, events-taxonomy-internal, claude-subagents,
  vastu, llm-cache, guardrails-validator, system-prompt-block, curator,
  critic, code-reviewer.

### LOW (39 packages)
Site-side, eval-only, or speculative-future — templates exist for
completeness but rarely scaffolded today:

  analytics, backend-core, behavior-suite, cast-bridge, chain-runner,
  cli, config, content-engine, dead-shell-detector, decomposer-recursive,
  dev-inspector, image-provider, integrity-check, local-llm-router-mcp,
  local-llm-router-py-client, local-rag, metrics, mentor-fastpath,
  orchestrator-elevate, playwright-config, prompt-evals, researcher,
  reviewer, secrets-broker, seo-program, skills-registry,
  steward-analyzers, steward-core, stolution-dispatch, story-decomposer,
  surface, test-isolation, test-kit, tracing, verifier, aiml-architect,
  apprentice-eval, apprentice-retrainer, apprentice-training.

## Anti-patterns observed

The survey turned up nine recurring anti-patterns. Each is a candidate
backlog item or refactor:

1. **Dormancy concentration.** 45/74 (61%) packages have zero in-repo
   importers. Even with the 4 false-positives from probe semantics, the
   fleet runs 56% un-wired. The LAI-A/IR-C wave in the v2 backlog targets
   12 of these; the rest need an archive/delete decision per
   `docs/DORMANT_PACKAGES.md` disposition.

2. **Bus-factor-1 surfaces.** `claude-subagents` and `vastu` each have
   exactly one in-repo importer. If that consumer drifts, the package
   becomes dormant. Either fold into a sibling or add a second consumer.

3. **Probe-vs-source-tree definitional drift.** `mentor-event-bus` and
   `chain-runner` are flagged dormant by `consumption-probe` but have
   17 + 0 grep-importers respectively. The probe's "no invocations in
   audit-jsonl ≥ 7d" definition diverges from "source-tree imports."
   Either rename the probe metric ("audit-cold" vs "source-dormant") or
   widen the probe to include grep-import counts. Recommend an `AN-*`
   backlog item.

4. **Concentration risk on `ticket-template`.** 82 importers — every
   Phase-1 agent stitches against this Zod schema. A breaking change
   ripples across the entire fleet. Document a deprecation policy
   (semver-major + 1-release deprecation cycle) and add a contract test
   that asserts the schema's v1 shape stays stable.

5. **Logger adoption sweep mid-flight.** `logger` has 27 importers but
   the `feat/d4-logger-adoption-sweep-2026-05-15` branch is still adding
   more. The scaffolder should bake `logger` into every new package's
   src template so future work auto-adopts it.

6. **Review-sibling cluster never spawned.** `critic`, `code-reviewer`,
   `reviewer`, `verifier` all built, none invoked. Either the spawner
   gating is too tight or the integration shim is missing. Worth a
   single chain to wire all four behind the spawner allowlist.

7. **Apprentice phases serialised but unblocked-loop missing.**
   `apprentice-corpus → apprentice-training → apprentice-eval →
   apprentice-serving → apprentice-retrainer` is a 5-package pipeline
   but only `corpus` and `serving` show importers — and `training` /
   `eval` / `retrainer` are dormant. There's no chained launchd /
   cron-trigger wiring. Backlog item: enable the pipeline end-to-end.

8. **Implicit `@pokerzeno/*` scope drift.** Three packages
   (`backend-core`, `cast-bridge`, `content-engine`, `integrity-check`,
   `seo-program`) live under the `@pokerzeno/*` npm scope but reside in
   the `@chiefaia/caia` monorepo. They're zero-importer on caia side
   because the consumer sites aren't in the monorepo. If those sites
   never land here, archive these to `packages/_archive/`.

9. **CLI-only packages misclassified.** `cli`, `chain-runner`,
   `dead-shell-detector`, `local-llm-router` (binary side) — these are
   invoked via plist-backed bins, not `import`-ed. Survey's grep-based
   importer count under-counts them. Recommend a second column in
   future surveys: `bin_invocations_seen` (audit-jsonl + plist).

## Suggested follow-ups (for v2 backlog)

1. `SCAFFOLD-A1` — Polish the HIGH-priority 15 templates (description +
   demonstrate_step + grep_match patterns) by hand. **m3, phase_count=1.**
2. `SCAFFOLD-A2` — Build the v2-templated-scaffolder itself: reads
   `.scaffold-templates/<pkg>.yaml` + an operator-supplied feature name
   and emits a ready-to-dispatch chain spec. **m3, phase_count=2.**
3. `SCAFFOLD-A3` — Add a CI lint that fails any new package missing a
   `.scaffold-templates/<pkg>.yaml`. **m3, phase_count=1.**
4. `AN-PROBE-1` — Rename `consumption-probe` metric to disambiguate
   audit-cold vs source-dormant; add grep-import column. **stolution,
   phase_count=1.**
5. `ARCHIVE-W1` — Move the 5 `@pokerzeno/*` packages with zero caia-side
   importers to `packages/_archive/`. **m3, phase_count=1.**

## Format example

```yaml
# Scaffold template for @chiefaia/local-llm-router
id: PKG_LOCAL_LLM_ROUTER
title: "Typical work shape — local-llm-router"
description: |
  Package: @chiefaia/local-llm-router
  Survey-line: LLM routing layer — dispatches tasks ...
machine: stolution
state: live
importers_seen: 21
file_paths:
  - packages/local-llm-router/src/<feature>.ts
  - packages/local-llm-router/tests/<feature>.test.ts
  - packages/local-llm-router/README.md
success_criteria:
  output_file: reports/stolution/local-llm-router-<feature>.md
  min_bytes: 1500
  grep_match: "healthz|kill -TERM|exit 0"
requires_merged_pr: true
phase_count: 2
deps: []
demonstrate_step: |
  Start daemon, curl /healthz returns 200, kill -TERM exits cleanly within 5s.
```
