# `@chiefaia/critic`

Pre-commit adversarial review agent for CAIA PRs. Reads unified diffs, runs deterministic detectors plus an LLM-reasoned tier (subscription `claude` binary), classifies findings into Mentor's 18-category failure-mode taxonomy, files them as PR comments. Steward consumes blocking findings (`severity >= high`).

Tier-A item 9 of `agent_ecosystem_expansion_directive.md`.

## Install (workspace-only — never published)

This package is `private: true` per Option E. Available as a workspace dep:

```json
{
  "dependencies": {
    "@chiefaia/critic": "workspace:*"
  }
}
```

## Library usage

```typescript
import { CriticAgent } from '@chiefaia/critic';

const critic = new CriticAgent({
  // All optional — CAIA defaults filled in.
  taxonomyPath:  '~/.../mentor_agent_directive.md',
  memoryRoot:    '~/.../agent/memory',
  enableLlmReasoning: true,            // false → deterministic tier only
  severityFloor: 'medium',
});

const review = await critic.reviewPR({
  prNumber: 393,
  diff: '<unified diff text>',
  context: { branch: 'feat/...', baseBranch: 'develop', title: '...' }
});

console.log(review.summary);
console.log(review.blockingFindings);  // severity >= 'high'
```

## CLI

```bash
# Review an open PR (uses gh pr diff)
caia-critic review --pr 393

# Review a diff file (no GitHub access needed)
caia-critic review --pr 393 --diff-file ./pr.diff --output json

# Severity-floor: only show medium+
caia-critic review --pr 393 --severity-floor medium

# Deterministic-only (skip LLM tier)
caia-critic dry-run --diff-file ./pr.diff --no-llm
```

CLI exit codes:
- `0` — no blocking findings
- `1` — at least one finding with `severity >= high`
- `2` — usage error or fatal exception

## Architecture

Two-tier detector pipeline:

```
diff → parser → hunks → ┬→ deterministic detectors (10) ─┐
                       └→ LLM-reasoned tier (claude bin) ─┴→ merger → AdversarialReview
```

**10 deterministic detectors** (regex / AST):
- `security-regression` — literal credential shapes (gh PATs, OpenAI/Anthropic keys, AWS keys, PEM, JWTs)
- `cost-overrun` — per-token API hosts (`api.anthropic.com`, etc.) + ANTHROPIC_API_KEY reads
- `git-branch-hygiene` — `gh pr update-branch`, `--force`, `filter-branch`, hard-reset to origin
- `premature-completion` — "complete/done/shipped" claims with tiny diffs or in markdown status lines
- `decision-classifier-violation` — option-presenting phrases ("should I", "your call") in operator-facing text
- `re-litigation` — markdown re-opening a topic settled in a `feedback_*.md` without referencing it
- `tool-misuse` — raw `curl`/`fetch` HTTP in source code where MCP/web_fetch is the right tier
- `recipe-rot` — docs referencing project paths that may not exist
- `false-modesty` — "I cannot / unable to" claims without justification
- `incompleteness` — new public exports in `src/` without test coverage in the same PR

**LLM-reasoned tier** covers the 8 remaining categories (`hallucination`, `scope-mismatch`, `wrong-direction`, `lacking-information`, `coordination-failure`, `operator-confusion`, `memory-drift`, `ci-flake-masquerade`) where adversarial reasoning is needed. Calls `claude --print --output-format json` and explicitly nukes `ANTHROPIC_API_KEY` from the spawned env per `feedback_no_api_key_billing.md`.

## Output shape

```typescript
interface AdversarialReview {
  prNumber: number;
  reviewedAtIso: string;
  totalFindings: number;
  findings: AdversarialFinding[];
  blockingFindings: AdversarialFinding[];   // severity >= 'high'
  summary: ReviewSummary;
}
```

Each `AdversarialFinding` carries: `category`, `severity`, `file`, `line`, `attackVector`, `description`, `reproductionSteps`, optional `suggestedMitigation`, `source` (`'deterministic' | 'llm-reasoned'`), `detectorId`, `excerpt`.

## Configuration

Every CAIA-specific path is a constructor parameter (Option E) with env-var fallback:

| Param | Env var | Default |
|---|---|---|
| `taxonomyPath` | `CAIA_TAXONOMY_PATH` | `<memoryRoot>/mentor_agent_directive.md` |
| `memoryRoot` | `CAIA_MEMORY_ROOT` | session memoryDir |
| `claudeBinaryPath` | `CLAUDE_BINARY_PATH` | `claude` |
| `modelTag` | `CRITIC_MODEL_TAG` | `claude-haiku-4-5-20251001` |
| `enableLlmReasoning` | `CRITIC_LLM_ENABLED` (`0` to disable) | `true` |
| `severityFloor` | `CRITIC_SEVERITY_FLOOR` | `low` |
| `maxDiffBytes` | `CRITIC_MAX_DIFF_BYTES` | `256000` |
| `chunkBytes` | `CRITIC_CHUNK_BYTES` | `64000` |
| `perVectorTimeoutMs` | `CRITIC_VECTOR_TIMEOUT_MS` | `60000` |
| `maxFindingsPerPr` | `CRITIC_MAX_FINDINGS` | `50` |

## Conformance

- ✅ Option E — private workspace package, parameterised constructor, fixture-tested
- ✅ Subscription-only LLM (`claude` binary subprocess + Ollama only — no API key billing)
- ✅ Mentor 18-category failure-mode taxonomy as the classification corpus
- ✅ 87 tests pass; 94.17% statement coverage
- ✅ Diff chunking (Datadog BewAIre lesson)
- ✅ Hallucination guard — drops LLM findings whose excerpt isn't in the diff

## See also

- `DESIGN.md` — full design rationale
- `mentor_agent_directive.md` ## Failure-mode taxonomy
- `agent_architecture_shape_2026-05-06.md` — Option E rule
- `~/Documents/projects/reports/critic-agent-e2e-verification-2026-05-06.md` — E2E results
