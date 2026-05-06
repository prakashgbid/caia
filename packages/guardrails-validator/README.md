# @chiefaia/guardrails-validator

Layer-2 input/output validation for agent LLM calls.

**Status**: v0.1.0 (Wave 2 W2-3 per `enterprise_ai_landscape_directive.md`)
**Private**: ✅ — never published to public npm
**Substrate**: pure TypeScript, all-local, no API keys, no Python bridge

## What it does

Sits between the capability-broker (Layer 1) and the LLM call boundary, catching prompt-injection / PII / secret / system-prompt-leakage / schema violations BEFORE downstream effects.

Disjoint from `@chiefaia/tool-output-sanitizer` (Layer 3): the sanitizer cleans tool-result text en route to agent context; this package validates agent-prompt + agent-output text en route to and from the LLM.

```
Layer 1 (request-time):   capability-broker
Layer 2 (input + output): guardrails-validator   ← THIS PACKAGE
Layer 3 (tool-result):    tool-output-sanitizer
Layer 4 (cost):           spend-guard
```

## Install

The package is private to the caia monorepo.

```jsonc
// package.json
{
  "dependencies": {
    "@chiefaia/guardrails-validator": "workspace:*"
  }
}
```

## Quick start

```ts
import { GuardrailsValidator } from '@chiefaia/guardrails-validator';

const validator = new GuardrailsValidator({
  systemPromptCorpus: '/* your agent's primer text */',
  onValidationEvent: (e) => emitLangfuseSpan(e),
});

// Pre-LLM: validate user input
const inputResult = validator.validateInput(prompt, 'untrusted-user-input');
if (inputResult.rejected) {
  throw new Error(`Input rejected: ${inputResult.flags.map(f => f.guardId).join(',')}`);
}
// inputResult.payload is possibly redacted — feed THAT to the LLM
const llmResponse = await spawnClaude(inputResult.payload);

// Post-LLM: validate response
const outputResult = validator.validateOutput(llmResponse, 'pre-publish');
if (outputResult.rejected) {
  throw new Error(`Output rejected: ...`);
}
return outputResult.payload;
```

A copy-paste reference wire-in helper is included as `runAgentWithGuardrails` in `tests/integration.test.ts`.

## Profiles

| Profile | Use case | Guards |
|---|---|---|
| `untrusted-user-input` | Prompt contains user-supplied content | injection (paranoid) + pii (redact) + secret (redact) |
| `inter-agent` | Agent-to-agent message body | injection (lenient) + secret (flag) |
| `pre-publish` | Output going to user / Langfuse / external | pii (redact) + secret (redact) + leakage (flag) |
| `tool-call-args` | Output is a tool-call JSON | injection (lenient) + secret (flag) + schema (when supplied) |
| `none` | Explicit opt-out (hot paths post-measurement) | (no-op) |

## Built-in guards

- **injectionGuard** — XML role tags, `[INST]` blocks, ignore-previous family, DAN/jailbreak, role-shift, tool-redefine, zero-width Unicode, ANSI escapes
- **piiGuard** — email, US phone, international phone, US SSN, Luhn-validated credit card, IPv4 (skips RFC1918 by default), IPv6
- **secretGuard** — OpenAI / Anthropic / AWS / GitHub / Google API keys, JWT, PEM private key headers, Slack tokens, plus a high-entropy fallback (Shannon ≥ 4.5 over 32+ char alnum slices)
- **leakageGuard** — contiguous token-overlap with the configured `systemPromptCorpus` (≥ 6 tokens by default)
- **schemaGuard** — opt-in zod schema validation per call

## Telemetry

Every `validate{Input,Output}` call emits a `ValidationEvent` to the configured `onValidationEvent` sink:

```ts
{
  profile: 'untrusted-user-input',
  direction: 'input',
  action: 'redact',
  flagCount: 2,
  guardIds: ['pii.email', 'secret.anthropic-api-key'],
  payloadChars: 142,
  durationMs: 1,
  rejected: false,
}
```

Map these onto Langfuse / OTel spans via the integration glue in `apps/orchestrator`.

## Performance budget

Heuristic-mode validators target ≤5ms p95 on 4KB inputs. The integration test has a soft probe (≤25ms average over 10 runs) to catch regressions in CI.

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm lint
```

## See also

- `DESIGN.md` — full design rationale and architecture decisions
- `~/Documents/projects/reports/guardrails-investigation-2026-05-06.md` — Stage 1 substrate-decision report
- `~/Documents/projects/reports/guardrails-validator-overlap-2026-05-06.md` — Stage 2 overlap analysis vs the existing safety stack
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E (the package shape rule this conforms to)
- `agent/memory/enterprise_ai_landscape_directive.md` — Wave 2 directive (parent backlog item)
