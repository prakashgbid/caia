# @chiefaia/system-prompt-block

Generates a stable, deterministic, ≤1K-token CAIA primer block to be prepended to every spawned agent's system prompt. Part of the **Option E (CAIA-Bonded Skeleton)** codification work — see `agent/memory/agent_architecture_shape_2026-05-06.md`.

## What it produces

A markdown digest of three sources:

1. The "Standing Instructions" section of `agent/memory/MEMORY.md`, alphabetised + collapsed-to-one-line
2. The H2 table-of-contents of `agent/memory/caia_architecture.md`
3. The 10-stage Definition of Done from `master_backlog_sequencing_2026-05-05.md`

## Why

Project-bonding for spawned agents. Every coding-agent task needs to know the standing rules before reasoning begins. A stable primer block bonds the generic agent shape to CAIA's specific conventions without consuming extra round-trips at spawn time — see §1.1 / §3 of the strategic-decision report.

## Usage

```ts
import { generateCaiaPrimer } from '@chiefaia/system-prompt-block';

// Default: reads from operator's session-memory paths.
const result = generateCaiaPrimer();
console.log(result.text);
console.log(result.estimatedTokens); // ≤ 1000

// Test/fixture corpus (Option E gate 3 — parameterisation must be exercised):
const result2 = generateCaiaPrimer({
  memoryIndexPath: '/path/to/fixture/MEMORY.md',
  architectureDocPath: '/path/to/fixture/architecture.md',
  dodSourcePath: '/path/to/fixture/sequencing.md',
  fsReader: myFakeFsReader,           // optional injection point
  tokenBudget: 800,
  summariseOnOverflow: true
});
```

## CLI

```bash
caia-system-prompt-block                              # print primer to stdout
caia-system-prompt-block --out /tmp/primer.md         # write to file
caia-system-prompt-block --token-budget 800 --summarise-on-overflow
caia-system-prompt-block --debug                      # print PrimerResult JSON
caia-system-prompt-block --help
```

## Build-time codegen

`pnpm build` runs the codegen script which writes `dist/caia-primer.md` — a stable fixture artifact that downstream consumers can read directly without invoking the generator at runtime. Same source inputs ⇒ byte-identical output (deterministic).

## Option E shape — self-conformance

This package itself follows the standing rule it's part of codifying:

- ✅ `"private": true` in package.json
- ✅ Public API parameterised — every CAIA-specific path is a constructor parameter with a CAIA default in `src/defaults.ts`
- ✅ Tests inject a fixture corpus (`tests/generate.test.ts`) and never touch live CAIA paths
- ✅ Determinism is verified by snapshot test
- ✅ Token-budget assertion is hard at the codegen step

The semgrep rule `caia-option-e-package-must-be-private` would block this package's PR if `private` were missing — lead-by-example.

## See also

- `agent/memory/agent_architecture_shape_2026-05-06.md` — standing rule
- `agent/memory/feedback_agent_architecture_option_e.md` — Mentor seed lesson
- `~/Documents/projects/reports/agent-architecture-strategic-decision-2026-05-06.md` §8.3 step 4
- `AGENTS.md` — project conventions every agent reads at task start
