# `@chiefaia/guardrails-validator` — Design

**Status**: v0.1.0 (Wave 2 W2-3 per `enterprise_ai_landscape_directive.md`)
**Date**: 2026-05-06
**Companion docs**: `~/Documents/projects/reports/guardrails-investigation-2026-05-06.md` (Stage 1), `~/Documents/projects/reports/guardrails-validator-overlap-2026-05-06.md` (Stage 2)

## Purpose

Layer-2 input/output validation for agent LLM calls. Sits between the capability-broker (Layer 1) and the LLM call boundary, catching prompt-injection / PII / secret / system-prompt-leakage / schema violations BEFORE downstream effects.

Disjoint from `@chiefaia/tool-output-sanitizer` (Layer 3): sanitizer cleans tool-result text en route to agent context; this package validates agent-prompt + agent-output text en route to and from the LLM.

## Build vs consume — substrate decision

`guardrailsai/guardrails-js` was investigated and rejected: requires Python 3.10+ on every host (the JS wrapper is an I/O bridge to the underlying Python lib) and the Hub validator-install path requires a free account+JWT token at `hub.guardrailsai.com/keys`. Both are architectural costs that don't compose with CAIA's TypeScript-native, all-local stack.

`@presidio-dev/hai-guardrails` (MIT, TS-native, v1.12.0) was the second candidate. Rejected as a v0.1.0 dependency for two reasons: (a) `@langchain/core` peer-dependency surface, only relevant if/when LLM-mode validators ship — which they don't in v1; (b) the v1 validator set we ship (injection / PII / secret / leakage / schema) is small enough that pure-TS in-house implementation costs less in lifetime maintenance than tracking an external project's API drift.

**Substrate**: pure TypeScript. Single runtime dep: `zod` for the optional schema guard. No transitive Python, no network at validation time, no LLM at validation time for the v1 profile set.

If LLM-mode validators (e.g., `topicGuard`, `hallucinationGuard`) prove necessary in v2, the engine interface defined here is shaped to accept an injected `LLMScorer` callable — which can be wired to Ollama via a thin adapter — without changing call sites.

## Public API

```ts
import { z } from 'zod';
import { GuardrailsValidator, type ValidationResult } from '@chiefaia/guardrails-validator';

const validator = new GuardrailsValidator({
  // every CAIA-specific value is constructor-injected with a CAIA default
  systemPromptCorpus: '/* the system-prompt-block primer */',
  customPiiPatterns: [],
  customSecretPatterns: [],
  customInjectionPatterns: [],
  // optional: emitter for Langfuse spans
  onValidationEvent: (e) => { /* span emit */ },
});

// Input check — before the LLM call
const inputResult = validator.validateInput(prompt, 'untrusted-user-input');
if (inputResult.action === 'reject') { /* halt */ }

// Output check — before downstream consumption
const outputResult = validator.validateOutput(response, 'pre-publish');
if (outputResult.action === 'reject') { /* halt */ }

// Schema variant — opt-in
const schemaResult = validator.validateOutput(response, 'tool-call-args', {
  schema: z.object({ tool: z.string(), args: z.record(z.unknown()) }),
});
```

### Types

```ts
type ProfileName =
  | 'untrusted-user-input'
  | 'inter-agent'
  | 'pre-publish'
  | 'tool-call-args'
  | 'none';

type GuardAction = 'pass' | 'flag' | 'redact' | 'reject';

interface ValidationFlag {
  guardId: string;        // e.g. 'pii.email', 'secret.aws-access-key'
  description: string;
  action: 'flagged' | 'redacted' | 'rejected';
  matchCount: number;
  matches?: string[];     // omitted when action === 'redacted' (raw secret would re-leak)
}

interface ValidationResult {
  payload: string;        // possibly redacted
  flags: ValidationFlag[];
  action: GuardAction;    // worst-case action across all flags
  rejected: boolean;
  profile: ProfileName;
}
```

## Profile composition (v1)

Per Stage 2 cut decisions:

| Profile | Guards |
|---|---|
| `untrusted-user-input` | `injection` (paranoid, threshold 0.6) + `pii` (redact) + `secret` (redact) |
| `inter-agent` | `injection` (lenient, threshold 0.85) + `secret` (flag) |
| `pre-publish` | `pii` (redact) + `secret` (redact) + `leakage` (flag) |
| `tool-call-args` | `injection` (lenient, threshold 0.85) + `secret` (flag) + `schema` (when schema arg supplied) |
| `none` | (no-op pass-through) |

Profiles are first-class objects; consumers may construct custom profiles by composing `Guard` instances directly via the lower-level `composeGuards` API. Defaults are CAIA's; overrides arrive via constructor injection.

## Guard catalogue (v1)

### `injectionGuard` (heuristic)

Detects prompt-injection patterns in input or output. Reuses the same regex set as `@chiefaia/tool-output-sanitizer`'s `PARANOID_PATTERNS` for catalogue consistency, plus heuristic scoring:
- Direct match → contributes weight 1.0
- Suffix match (e.g. "ignore the last instruction") → 0.7
- Stem match (e.g. "ignore prev") → 0.4
- String-similarity ≥ 0.85 to a known-attack stem → 0.5

Returns a numerical score 0..1; ≥ threshold → flag/reject.

### `piiGuard`

Pattern catalogue:
- `pii.email` — RFC-5322-lite email
- `pii.phone-us` — US phone (xxx-xxx-xxxx, (xxx) xxx-xxxx, 10-digit)
- `pii.phone-international` — `+CC NNNNNNNN` minimal form
- `pii.ssn-us` — US SSN
- `pii.credit-card` — Luhn-validated 13-19 digit card numbers
- `pii.ipv4` — IPv4 address (configurable: skip private ranges by default)
- `pii.ipv6` — IPv6 address (full or compressed)

Action: `redact` (replace each match with `[REDACTED:<guard-id>]`) by default, configurable to `flag`.

### `secretGuard`

Pattern catalogue (prefix-anchored):
- `secret.openai-api-key` — `sk-[A-Za-z0-9]{32,}`
- `secret.anthropic-api-key` — `sk-ant-[A-Za-z0-9_-]{20,}`
- `secret.aws-access-key` — `AKIA[0-9A-Z]{16}`
- `secret.github-token` — `ghp_[A-Za-z0-9]{36,}` / `github_pat_[A-Za-z0-9_]{82,}`
- `secret.private-key-pem` — `-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`
- `secret.jwt` — JWT header.payload.signature shape
- `secret.high-entropy` — Shannon entropy ≥ 4.5 over a 32+ char alnum slice (catches unknown-prefix tokens)

Action: `redact` by default. Configurable to `flag`.

### `leakageGuard`

Compares output against the configured `systemPromptCorpus` (default: empty; consumers inject their primer). Flags any 6+ token contiguous overlap. Uses character-trigram cosine similarity above threshold (default 0.6).

Action: `flag` only. Redaction risks destroying legitimate output that incidentally rephrases a primer line.

### `schemaGuard`

Optional per-call. Caller passes a `zod` schema; if `safeParse` fails, action = `reject` and `ValidationFlag.matches` carries the zod error path-list.

## Constructor configuration matrix

Every CAIA-specific path/value is a constructor parameter with a CAIA default.

```ts
interface GuardrailsValidatorConfig {
  systemPromptCorpus?: string;                  // default: '' (consumer injects)
  customInjectionPatterns?: readonly RegExp[];  // default: []
  customPiiPatterns?: readonly NamedPattern[];  // default: []
  customSecretPatterns?: readonly NamedPattern[]; // default: []
  injectionThresholds?: { paranoid: number; lenient: number };
  // default: { paranoid: 0.6, lenient: 0.85 }
  leakageThreshold?: number;                    // default: 0.6
  ipv4SkipPrivateRanges?: boolean;              // default: true
  onValidationEvent?: (e: ValidationEvent) => void;
}

interface NamedPattern {
  id: string;
  description: string;
  re: RegExp;
}
```

Tests inject fixture corpora via these parameters; production injects CAIA defaults via the orchestrator wiring. The Option E pre-send check #3 ("tests use fixture corpora, not live CAIA paths") is honoured by design.

## Layer integration

The package ships a thin pre-LLM and post-LLM integration helper:

```ts
// In an agent's Hono runtime adapter:
const inputResult = validator.validateInput(prompt, profileForTask(task));
emitLangfuseSpan(inputResult);
if (inputResult.action === 'reject') {
  await pauseRun(runId, 'guardrails.input-rejected', inputResult);
  throw new ValidationRejectedError(inputResult);
}
const llmResponse = await spawnClaude(inputResult.payload, /* using redacted text */);
const outputResult = validator.validateOutput(llmResponse, 'pre-publish');
emitLangfuseSpan(outputResult);
if (outputResult.action === 'reject') {
  await pauseRun(runId, 'guardrails.output-rejected', outputResult);
  throw new ValidationRejectedError(outputResult);
}
return outputResult.payload; // possibly redacted
```

## Telemetry

Each `ValidationEvent` carries:
- `caia.guardrails.profile`
- `caia.guardrails.action`
- `caia.guardrails.flag_count`
- `caia.guardrails.guard_ids` (array)
- `caia.guardrails.payload_chars`
- `caia.guardrails.duration_ms`

When `action === 'reject'`, `caia.guardrails.rejected = true` is also set. Consumers map this onto Langfuse / OTel span attributes.

## Performance budget

Heuristic-mode validators: O(n) regex passes + Luhn check + entropy scan. Target: ≤ 5ms p95 per validation call for typical agent prompts (2–8 KB). Validation results are not cached; the regex engine compiles patterns once in the constructor.

## Out of scope (v1)

- LLM-mode injection scoring (`topicGuard`, `hallucinationGuard`). Deferred until LLM scorer interface stabilises (post-Librarian Mem0 swap completion).
- Image / multimodal content. CAIA doesn't surface multimodal agent inputs at this scale.
- Streaming validation. Validators are batch-only; streaming responses are buffered to completion before validation. Acceptable for current agent surfaces.

## Migration / rollout plan

| Step | Action |
|---|---|
| 1 | Ship package as `@chiefaia/guardrails-validator` v0.1.0 (private) |
| 2 | Wire into a single pilot agent (Mentor or Curator) behind a feature flag, profile defaulted to `inter-agent` (lowest-disruption profile) |
| 3 | Run 20-pair E2E pass against recent Langfuse traffic; measure false-positive rate |
| 4 | Promote to `untrusted-user-input` profile at user-input ingress (orchestrator HTTP boundary) |
| 5 | Document integration pattern; broadcast for adoption by other agents |

Future: when Aider-style udiff coding-agent ships, add `tool-call-args` profile at the diff-emission boundary.

## Re-evaluation triggers

1. **False-positive rate > 5%** in production after 2 weeks → tune thresholds, add allow-list patterns.
2. **A new attack class lands** that the heuristic catalogue doesn't cover → consider opting into LLM-mode injectionGuard.
3. **CAIA productises** → re-evaluate whether to publish this package as `@anthropic/guardrails-validator-ts` per Option E "second-internal-consumer trigger".
4. **Upstream Guardrails AI ships first-party TS without Python bridge** → re-evaluate substrate substitution.
