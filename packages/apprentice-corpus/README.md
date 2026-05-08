# `@chiefaia/apprentice-corpus`

Phase 0 of the [Apprentice Agent](../../docs/EA/) — corpus aggregator.

Walks CAIA's accumulated artifacts (Mentor events, agent/memory directives + feedback, reports, GitHub PR history, Langfuse traces) and normalises them into a unified instruction-output JSONL corpus suitable for QLoRA fine-tuning of a 7B base model on Mac M-series via MLX-LM.

**Shape**: Option E (CAIA-Bonded Skeleton) — private workspace package, fully parameterised constructor with CAIA defaults, fixture-corpora-tested, never published.

## Pipeline

```
SourceReader[]  →  RawArtifact[]
              →  InstructionPair[]    (normaliser)
              →  dedupe
              →  PII mask
              →  quality score
              →  distill (claude binary subprocess) for low-quality
              →  cap @ maxSamples
              →  write samples.jsonl + manifest.json
```

## Programmatic use

```typescript
import { ApprenticeCorpusAggregator } from '@chiefaia/apprentice-corpus';

// All defaults bond to CAIA
const aggregator = new ApprenticeCorpusAggregator();
const manifest = await aggregator.aggregate();
console.log(`final corpus: ${manifest.totals.final} samples at ${manifest.outputDir}`);
```

Override any default via the constructor (testability + non-CAIA fixtures):

```typescript
const aggregator = new ApprenticeCorpusAggregator({
  memoryRoot: '/path/to/test/memory',
  reportsRoot: '/path/to/test/reports',
  outputRoot: '/tmp/test-corpus',
  distillEnabled: false,
  qualityThreshold: 0.0,
  fs: customFsReader,
  eventBus: customEventBusClient,
});
```

## CLI

```bash
# Run with CAIA defaults (env-var overrides supported)
caia-apprentice-corpus aggregate

# Plan only (no writes)
caia-apprentice-corpus aggregate --dry-run

# Override single config
caia-apprentice-corpus aggregate --memory-root /path --no-distill

# Help
caia-apprentice-corpus --help
```

Env vars (in priority order: CLI flag → env → CAIA fallback):

- `CAIA_MEMORY_DIR` — orchestrator session's `agent/memory/` path
- `CAIA_REPORTS_DIR` — `~/Documents/projects/reports`
- `CAIA_EVENTS_DB` — Mentor events.sqlite path
- `CAIA_GITHUB_REPO` — `chiefaia/caia`
- `APPRENTICE_CORPUS_ROOT` — `~/Documents/projects/apprentice/corpora`
- `CLAUDE_BINARY_PATH` — `claude`

## Output layout

```
<outputRoot>/<YYYY-MM-DD>/
├── manifest.json     — summary + per-source + histograms + config hash
├── samples.jsonl     — one JSON / line; `messages[]` payload trainable as-is by MLX-LM --data-format messages
├── sources.json      — index of source artifacts considered
├── dropped.jsonl     — one record / drop with `reason`
└── config.json       — sanitized config snapshot
```

`samples.jsonl` shape:

```json
{
  "id": "<sha256>",
  "messages": [
    {"role": "system", "content": "<CAIA primer>"},
    {"role": "user", "content": "<derived instruction>"},
    {"role": "assistant", "content": "<derived response>"}
  ],
  "meta": {
    "source": "memory|reports|events|langfuse|github",
    "sourceId": "...",
    "kind": "directive|feedback|PRMerged|...",
    "qualityScore": 0.0-1.0,
    "distilled": false,
    "redactedSpans": ["email", "secret", "path"],
    "createdAt": "<ISO 8601>",
    "contentSha256": "<sha256>"
  }
}
```

## Hard constraints

- 🚨 **No API-key billing.** Distillation uses `claude` subprocess + subscription session only. `ANTHROPIC_API_KEY` is explicitly cleared from the spawned env.
- 🚨 **PII masking**: credential shapes (sk-, ghp_, glpat-, AWS access keys, generic secret-keyword + value), emails, and `/Users/<name>/`+`/home/<name>/` paths are masked. Operator's name + email NOT auto-redacted (intentional training signal). Add `extraRedactPatterns` to override.
- 🚨 **Distillation budget**: `maxDistillCalls` (default 200) caps subscription-bucket consumption per run.
- 🚨 **Langfuse stub**: returns `[]` until Langfuse goes operational; toggle via `langfuseEnabled: true`.

## Deployment

LaunchAgent runs daily at 02:00 local. Install:

```bash
# Build first
pnpm --filter @chiefaia/apprentice-corpus build

# Pass the current orchestrator session id (replace with current value)
packages/apprentice-corpus/scripts/install-apprentice-corpus.sh \
  6c9158cd-cd01-44af-b82f-bf27b437c618/84f7697e-7ae3-4ba4-9f98-166613a82e98
```

The install script renders the plist with the local node binary path, package
directory, $HOME, claude binary path and the supplied session id; bootstraps
the agent into the user gui domain via `launchctl bootstrap`; and kickstarts
a one-off run for immediate verification. Idempotent — bootouts any existing
instance first. Pass `--no-kickstart` to skip the immediate run, or
`CAIA_DRY_INSTALL=1` to render and lint the plist without touching launchd.

Manual ops:

```bash
launchctl kickstart -k gui/$(id -u)/com.chiefaia.apprentice-corpus  # one-off run
tail -f ~/Library/Logs/chiefaia/apprentice-corpus.log               # tail logs
launchctl bootout gui/$(id -u)/com.chiefaia.apprentice-corpus       # uninstall
```

Logs at `~/Library/Logs/chiefaia/apprentice-corpus.log`.

## Testing

```bash
pnpm test          # 98 tests (13 unit + 5 integration files)
pnpm typecheck
pnpm lint
pnpm build
```

Tests inject fixture corpora at `tests/__fixtures__/mini-{memory,reports}/` — never live CAIA paths. The default constructor (CAIA defaults) is exercised in E2E only.

## See also

- [`DESIGN.md`](DESIGN.md) — full architecture rationale
- `agent/memory/apprentice_agent_directive.md` — Phase 0 spec
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E standing rule
- `~/Documents/projects/reports/agent-architecture-strategic-decision-2026-05-06.md` §5 — bonding mechanism
