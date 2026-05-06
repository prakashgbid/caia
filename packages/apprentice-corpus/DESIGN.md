# `@chiefaia/apprentice-corpus` — Phase 0 Design

**Status**: Phase 0 of the Apprentice Agent (per `agent/memory/apprentice_agent_directive.md`).
**Shape**: Option E — CAIA-Bonded Skeleton (per `agent_architecture_shape_2026-05-06.md`).
**Author**: Apprentice Phase 0 leg 2 (2026-05-06).
**Scope**: corpus aggregator only. Phases 1-4 (eval, training, serving, retrainer) are siblings, NOT this package.

## 1. Mandate

Aggregate CAIA's accumulated artifacts (events, memory, reports, traces, GitHub history) into a unified instruction-output corpus suitable for QLoRA fine-tuning of a 7B base model on Mac M-series. Output is a date-stamped corpus directory containing `samples.jsonl` plus `manifest.json`.

Phase 1 (eval harness) consumes the manifest to score base + adapter; Phase 2 (training) consumes `samples.jsonl` directly via MLX-LM `--data-format messages`.

## 2. Package shape (Option E checklist)

- ✅ `packages/apprentice-corpus/` (NOT `apps/apprentice/corpus-aggregator/` — apps consume packages)
- ✅ `package.json`: `"private": true`, scope `@chiefaia/apprentice-corpus`, never published
- ✅ Public API parameterised via `ApprenticeCorpusConfig` constructor — every CAIA path/URL/topic/registry is a parameter with a CAIA default
- ✅ Tests inject fixture corpora at `tests/__fixtures__/mini-{memory,reports,events}/` — never live CAIA paths
- ✅ Pre-spawn injection: when this aggregator distills via `claude` binary, the prompt passes through `caia-mentor-prepend | caia-librarian-prepend` (unchanged from existing CAIA convention) — orchestrator wires; package itself doesn't bypass
- ✅ AGENTS.md (when filed at repo root) is consulted for build/test/lint commands; this package has no special override

## 3. Public API

```typescript
import { ApprenticeCorpusAggregator } from '@chiefaia/apprentice-corpus';

const aggregator = new ApprenticeCorpusAggregator({
  // All optional — CAIA defaults filled in by constructor.
  memoryRoot: '/Users/MAC/Library/Application Support/Claude/local-agent-mode-sessions/<session>/agent/memory',
  reportsRoot: '~/Documents/projects/reports',
  eventsDbPath: '~/.caia/mentor/events.sqlite',  // mentor-event-bus default
  langfuseProjectId: 'caia-prod',                // stub — Langfuse not yet operational
  langfuseEnabled: false,                         // explicit opt-in once Langfuse ships
  githubRepo: 'chiefaia/caia',
  outputRoot: '~/Documents/projects/apprentice/corpora',
  claudeBinaryPath: 'claude',
  distillEnabled: true,
  // Behaviour knobs:
  maxSamples: 50_000,
  minSampleLengthChars: 80,
  maxSampleLengthChars: 16_000,
  qualityThreshold: 0.4,
  redactPII: true,
  // Dependency injection (test seams):
  fs: defaultFsReader,
  eventBus: defaultEventBusClient,
  github: defaultGithubClient,
  langfuse: defaultLangfuseClient,
  claudeDistiller: defaultClaudeDistiller,
  clock: () => new Date(),
});

const manifest = await aggregator.aggregate();
// manifest.outputDir is `<outputRoot>/<YYYY-MM-DD>/`
// manifest.totals.final is the final sample count
```

CLI:

```bash
caia-apprentice-corpus aggregate                    # use CAIA defaults
caia-apprentice-corpus aggregate --dry-run          # plan only, no writes
caia-apprentice-corpus aggregate --memory-root X    # override single param
```

## 4. Source readers

Each reader implements:

```typescript
interface SourceReader {
  readonly source: SourceTag;       // 'events'|'memory'|'reports'|'langfuse'|'github'
  read(ctx: ReaderContext): Promise<RawArtifact[]>;
}

interface RawArtifact {
  source: SourceTag;
  sourceId: string;        // file path / event id / trace id / PR number
  correlationId?: string;  // optional thread-id for grouping
  kind?: string;           // memory: directive/feedback/...; events: TaskCompleted/...
  text: string;            // raw textual content
  sidecar?: Record<string, unknown>;  // optional structured metadata
  createdAtMs: number;
}
```

**5 readers:**

| Reader | Substrate | Default behaviour | Phase 0 status |
|--------|-----------|-------------------|----------------|
| `event-bus-reader.ts` | `@chiefaia/mentor-event-bus` `queryEvents` over events.sqlite | All events; chronological; bounded by `maxAgeDays` (default 365) | full |
| `memory-walker.ts` | node:fs over `memoryRoot` | Walks `*.md`, classifies by filename (directive/feedback/proposal/...), mirrors librarian `pathToKind` rules | full |
| `reports-walker.ts` | node:fs over `reportsRoot` | Walks `*.md`, treats each as one artifact | full |
| `langfuse-reader.ts` | fetch /api/public/traces (placeholder) | Returns `[]` if `langfuseEnabled=false` (default); when enabled, paginates traces | **STUB** — full impl deferred to leg 3 once Langfuse operational |
| `github-reader.ts` | `gh` subprocess (`gh pr list --json`, `gh api`) | Pulls merged PR titles + bodies + Evidence-Gate check results; rate-limited; bounded by `maxAgeDays` | full |

Each reader is independently testable with a fixture-based fake. The aggregator depends on the `SourceReader[]` array, NOT on the concrete fs/event-bus/gh — those are injected via the config.

## 5. Normaliser — RawArtifact → InstructionPair

Heuristics per source kind. The normaliser is a single function with a switch on `source + kind`:

| Source/kind | Instruction | Response | Notes |
|-------------|-------------|----------|-------|
| `memory/directive` | "Summarize the standing rule in this directive." | First non-frontmatter paragraph + key bullets | Title becomes part of the instruction. |
| `memory/feedback` | "What does this feedback say to do/avoid, and why?" | Body + the **Why:** + **How to apply:** lines | Required for catching operator's voice |
| `memory/architecture` | "Explain the architectural decision in this document." | Body extract | Inputs trimmed to `maxSampleLengthChars`. |
| `events/PRMerged` | "What was merged in this PR, and what was its purpose?" | Title + body if available | Pulls from event payload. |
| `events/PostMergeBugReport` | "A regression was reported. What was the issue, and what was learned?" | Body | Used to reinforce DoD discipline. |
| `events/OperatorCorrection` | "An operator correction was issued. What was wrong, and what's the corrected approach?" | Body | High-quality signal — operator's voice |
| `events/EvidenceGateFailure` | "An Evidence Gate check failed. What was the failure, and how should it be avoided?" | Body | Mentor's territory but corpus-relevant. |
| `reports/*` | "Summarize this report." | First section + section headings | Reports are diverse; light touch. |
| `github/PR` | "What was the goal of this PR and how was it accomplished?" | Title + body + linked issue + checks | Distilled by claude if low-quality. |

Skipped artifacts (no instruction-output extractable): files with frontmatter only, empty events, files smaller than `minSampleLengthChars`.

System message attached to every sample: a stable ≤500-token CAIA primer (constants/`SYSTEM_PROMPT.md`-like) covering the 10-stage DoD, decision-classifier, no-API-key-billing, git-flow rules.

## 6. Dedupe

`Set<contentSha256>` over the normalised `messages[].content` joined by `\n`. First occurrence wins; duplicates dropped. Hash is stored on every sample's `meta.contentSha256` for downstream consumers (Phase 1 eval harness uses it to detect train/eval contamination).

## 7. PII masker

Three regex passes, conservative (false-positives acceptable; false-negatives unacceptable for training data):

1. **Email** — `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` → `[redacted-email]`
2. **API-key-shapes** (gitleaks-style):
   - `sk-[A-Za-z0-9]{20,}` → `[redacted-secret]` (Anthropic / OpenAI shape)
   - `ghp_[A-Za-z0-9]{36}` → `[redacted-secret]` (GitHub PAT)
   - `glpat-[A-Za-z0-9_-]{20}` → `[redacted-secret]` (GitLab PAT)
   - 32-byte+ hex blocks adjacent to common secret keywords (`secret|password|token|api[_-]?key`) → `[redacted-secret]`
3. **Local paths with username** — `/Users/[A-Za-z0-9_-]+/` → `~/` (per `path-standards.md`)

The set of redacted span types per sample is recorded in `meta.redactedSpans` for audit.

Operator's name + email (`Prakash`, `prakashmailid@gmail.com`) NOT auto-redacted — these appear deliberately in directives + memory and are intentional training signal. The PII-mask path is for credentials, not identities.

## 8. Quality filter

Each `InstructionPair` gets a quality score 0..1 from a small set of heuristics:

| Heuristic | Weight | Direction |
|-----------|--------|-----------|
| Length within `[minSampleLengthChars, maxSampleLengthChars]` | 0.30 | bonus |
| Response has structure (bullets / headers / paragraphs > 1) | 0.20 | bonus |
| Source is a directive/feedback (operator's voice) | 0.20 | bonus |
| Response contains common "thinking-aloud" filler tokens (`um`, `you know`, voice-transcription artifacts) | 0.20 | penalty |
| Response is mostly code (≥70% of chars inside backticks) | 0.10 | bonus (code is high-signal for coding adapter) |

Samples with `qualityScore < qualityThreshold` (default 0.4) are NOT discarded directly — they are routed to the **claude-distiller** for refinement. If the distiller can't lift them above threshold, they're dropped with a record in the manifest.

## 9. Claude distillation step

For samples below quality threshold (or marked `distill: true` by source-specific heuristics — e.g. all GitHub PR samples without bodies), invoke `claude` binary subprocess to refine.

**Subprocess pattern** — crib from `@chiefaia/local-llm-router`'s `claude-adapter.ts`:

```typescript
const result = spawnSync(claudeBinaryPath, [
  '--print',
  '--output-format', 'json',
  '--model', 'claude-haiku-4-5-20251001',  // cheap; distillation, not reasoning
], {
  input: distillationPrompt,
  env: { ...process.env, ANTHROPIC_API_KEY: undefined },  // FORBIDDEN — subscription only
  timeout: 30_000,
  encoding: 'utf-8',
});
```

**Distillation prompt template** (lives in `src/distill-prompt.txt`):

> You are extracting a high-quality instruction-response pair for fine-tuning. Given the raw artifact below, produce a clean Q/A pair that captures the substantive content. Drop voice-transcription noise. Keep operator decisions verbatim. Output strict JSON `{"instruction": "...", "response": "..."}`.
>
> Raw artifact source: `<source>:<kind>`
> Raw artifact:
> ```
> <text>
> ```

If the binary spawn fails (rate-limited, missing, or returns malformed JSON), the sample is dropped with `dropReason: 'distill-failed'` recorded in the manifest. We NEVER fall back to API-key billing.

**Distillation budget** — bounded by `maxDistillCalls` (default 200). When the budget is exhausted, remaining low-quality candidates are dropped without distillation. The cap is conservative to keep the daily aggregator well under subscription limits.

Distillation is OFF by default in tests (`distillEnabled: false` in the fixture default), and the integration test stubs it. The full path is exercised only in E2E.

## 10. Manifest writer

Final layout per run:

```
<outputRoot>/<YYYY-MM-DD>/
├── manifest.json
├── samples.jsonl
├── sources.json         # one entry per source artifact considered
├── dropped.jsonl        # artifacts dropped, with reason
└── config.json          # snapshot of effective config (with secrets stripped)
```

`manifest.json` schema (versioned):

```json
{
  "version": 1,
  "generatedAt": "<ISO 8601 UTC>",
  "outputDir": "<absolute path>",
  "elapsedMs": 12345,
  "totals": {
    "rawArtifacts": 2400,
    "afterDedup": 2150,
    "afterPII": 2150,
    "afterQuality": 1820,
    "distilled": 130,
    "dropped": 460,
    "final": 1820
  },
  "perSource": {
    "events": {"artifacts": 1200, "samples": 980},
    "memory": {"artifacts": 350, "samples": 340},
    "reports": {"artifacts": 180, "samples": 170},
    "github": {"artifacts": 670, "samples": 330},
    "langfuse": {"artifacts": 0, "samples": 0}
  },
  "redactedSpansHistogram": {"email": 12, "secret": 0, "path": 240},
  "qualityHistogram": {"0.0-0.2": 0, "0.2-0.4": 0, "0.4-0.6": 800, "0.6-0.8": 760, "0.8-1.0": 260},
  "configSha256": "<hex>",
  "warnings": [],
  "holdout": ["<sha256-id>", "<sha256-id>", "..."]
}
```

The `holdout` array contains the stable ids of curated pairs that were excluded from `samples.jsonl` and reserved as a deterministic test set for Phase 1's `apprentice-eval` harness. Sampling is seeded by `holdoutSeed` (config; default 42) and the fraction by `holdoutFraction` (default 0.05 — 5%); reruns of the same config produce identical holdouts. Pair ordering inside the input is irrelevant — we sort by the pair's own stable id (sha256) before sampling.

The manifest is the canonical artifact for Phase 1 eval harness + Phase 4 retrainer cron's "is there enough new data to retrain?" check.

## 11. Aggregator orchestration

The top-level `aggregate()` method runs the pipeline:

```
readers (parallel)
   → flatten to RawArtifact[]
   → normalise to InstructionPair[]
   → dedupe (drop)
   → PII-mask (mutate; record spans)
   → quality-score
   → split into [≥threshold] and [<threshold]
   → distill the latter (subprocess; bounded; respect budget)
   → re-score; merge with passing set
   → cap at maxSamples (highest quality first; ties broken by recency)
   → write samples.jsonl + manifest.json + sources.json + dropped.jsonl + config.json
   → return manifest
```

All steps are pure functions on plain data. The only IO happens at:
1. The 5 source readers (read).
2. The claude-distiller (subprocess).
3. The manifest writer (write).

This keeps the test surface clean — most logic is testable with fixture corpora and zero IO.

## 12. CAIA-bonding

The CAIA defaults baked into the constructor:

```typescript
const CAIA_DEFAULTS: Required<ApprenticeCorpusConfig> = {
  memoryRoot: process.env.CAIA_MEMORY_DIR
    ?? expandHome('~/Library/Application Support/Claude/local-agent-mode-sessions/<resolved-at-runtime>/agent/memory'),
  reportsRoot: process.env.CAIA_REPORTS_DIR ?? expandHome('~/Documents/projects/reports'),
  eventsDbPath: process.env.CAIA_EVENTS_DB ?? expandHome('~/.caia/mentor/events.sqlite'),
  langfuseEnabled: false,
  langfuseProjectId: 'caia-prod',
  githubRepo: process.env.CAIA_GITHUB_REPO ?? 'chiefaia/caia',
  outputRoot: process.env.APPRENTICE_CORPUS_ROOT ?? expandHome('~/Documents/projects/apprentice/corpora'),
  claudeBinaryPath: process.env.CLAUDE_BINARY_PATH ?? 'claude',
  distillEnabled: true,
  maxSamples: 50_000,
  minSampleLengthChars: 80,
  maxSampleLengthChars: 16_000,
  qualityThreshold: 0.4,
  maxDistillCalls: 200,
  maxAgeDays: 365,
  redactPII: true,
};
```

Defaults are surveyed for a Library-path resolver that picks the *current* orchestrator session — Phase 0 leg 2 ships a fixed-path env-var fallback for now (operator can set `CAIA_MEMORY_DIR` if the session ID rotates).

## 13. Out-of-scope (do NOT build in this leg)

- **Apprentice Phase 1** (eval harness) — separate package `packages/apprentice-eval/`
- **Apprentice Phase 2** (training) — separate package `packages/apprentice-training/`
- **Phase 3-4** — separate packages
- **Langfuse integration** — stub only; full reader deferred to leg 3 once Langfuse operational
- **Cowork session transcript ingestion** — directive lists it as source #1 but the export pipeline is separately specced in the directive's "Triggers to start work" section; deferred to leg 3
- **Mentor's lesson-typed corpus** — Mentor already exposes its own pre-spawn-injection corpus; we do NOT duplicate it. The `events` reader pulls raw events; Mentor's curated lessons stay in Mentor's domain

## 14. Testability checklist (Option E pre-send check)

- ✅ Package private (`package.json` has `"private": true`)
- ✅ Public API parameterised — every CAIA path/URL/topic is a constructor parameter with a default
- ✅ Tests use fixture corpora at `tests/__fixtures__/mini-{memory,reports,events}/`
- ✅ Mentor + Librarian pre-spawn injection respected (the claude-distiller is the only LLM-call site; orchestrator wires the prepends; package doesn't bypass)
- ✅ No abstraction for a second consumer

## 15. Risks

| Risk | Mitigation |
|------|------------|
| Operator-name/email-in-corpus may be undesired by future eval | Documented in §7; opt-in extra redaction via `extraRedactPatterns: RegExp[]` config knob |
| Langfuse stub returns empty → Phase 1 eval has gaps | Documented in §13; full impl deferred but planned for leg 3 |
| GitHub `gh` rate limits during heavy runs | Bounded by `maxAgeDays` + paginated reads; if rate-limited, emit warning + continue with partial set |
| Mentor events DB locked during read | better-sqlite3 opens read-only with `WAL` mode; tested |
| Disk fills with cumulative corpora | Caller's responsibility (cron rotation + `--max-output-dirs` not in this package); documented in README |
| Claude binary missing at distillation time | Sample dropped with `dropReason: 'distill-failed'`; pipeline continues |
| Catastrophic forgetting (operator-style overfitting) at training time | NOT this package's concern (Phase 2 territory); but quality filter §8 guards against thinking-aloud filler accumulation |

## 16. Deployment

LaunchAgent `plists/com.chiefaia.apprentice-corpus.plist` runs `caia-apprentice-corpus aggregate` daily at 02:00 local. Output goes to `~/Documents/projects/apprentice/corpora/<YYYY-MM-DD>/`. Failures append to `~/Library/Logs/chiefaia/apprentice-corpus.log`.

Install:

```bash
cp packages/apprentice-corpus/plists/com.chiefaia.apprentice-corpus.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.chiefaia.apprentice-corpus.plist
```
