# @chiefaia/chain-scaffolder

Chain scaffolder for [@chiefaia/chain-runner] — converts backlog items into
chain definitions (`state.json` + `phases.yaml` + runner script) ready for
the autonomous chain runner.

Two modes:

| Mode          | Input                                                     | Cost | Status               |
| ------------- | --------------------------------------------------------- | ---- | -------------------- |
| **LLM**       | Loose markdown line: `id :: title :: description`         | $$   | ✅ this package      |
| **Templated** | Structured YAML backlog item with explicit fields         | free | 🚧 sibling phase     |

The LLM path is for loose items where the operator has only a one-line idea;
the scaffolder gathers codebase context (file reads + grep + optional
[local-llm-router] semantic search) and asks an LLM to produce a fully-formed
`phases.yaml` that round-trips through `@chiefaia/chain-runner`'s loader.

## CLI

```sh
caia-scaffold from-llm "my-item :: Short title :: What this does and why" \
  [--context-files caia/packages/foo/src/bar.ts ...] \
  [--provider auto|claude|local|fixture] \
  [--machine m3|m1|stolution] \
  [--few-shot-example PATH] \
  [--out-dir DIR] \
  [--router-url http://127.0.0.1:7411] \
  [--no-write] [--json]

caia-scaffold validate <phases.yaml>     # schema check, read-only
```

### Backlog-line shape

```
<kebab-id> :: <title> :: <description> [machine=m1] [file=src/a.ts,src/b.ts]
```

Annotations after the third `::` are optional and forgiving:

- `machine=m3|m1|stolution` — routing hint
- `file=...,...`           — comma-separated file_paths
- `deps=chain-a,chain-b`   — chain ids that must finish first

### Provider resolution

`--provider auto` (default) prefers `local` when `local-llm-router` is reachable
at `--router-url`, otherwise falls back to the `claude` CLI on PATH. Override
with `--provider claude` or `--provider local`.

The `fixture` provider is for tests/CI and requires `--fixture-file <path>`.

## Programmatic

```ts
import { scaffoldFromLlm, specToYaml } from '@chiefaia/chain-scaffolder';

const result = await scaffoldFromLlm({
  id: 'my-item',
  title: 'Short title',
  description: 'Long description',
  machine: 'm3',
});
const yamlText = specToYaml(result.spec);
// → write to ~/Documents/projects/agent-memory/<id>_phases.yaml
```

`scaffoldFromLlm` flow:

1. Resolve provider (auto/claude/local).
2. Load few-shot example (`sps_router_critical_fixes_phases.yaml` by default).
3. Gather context: read explicit + item-hinted files (truncated), grep the
   repo for keywords derived from id/title, optionally hit the local router
   for semantic results.
4. Build the system + user prompt; call the provider.
5. Parse + validate the response (`parseScaffolderSpec`). On `SchemaError`,
   retry **once** with the errors fed back into the user message.
6. Finalise defaults (`chain_config.machine`, `alert_channels`, etc.) and
   return `{ chain_id, spec, raw, attempts }`.

## Schema

The validator (`src/schema.ts`) enforces:

- `phases: [...]` non-empty, sequential ids `1..N`, max 20.
- Each phase has `name`, `prompt_template` (≥40 chars), `success_criteria.output_file`.
- `deps` reference strictly-earlier phase ids.
- Optional `defaults`, `chain_config`, `max_minutes`, `min_bytes`,
  `grep_match`, `requires_merged_pr`, `enforce: warn|strict`.

Output round-trips through `loadChainSpec` in `@chiefaia/chain-runner` — the
integration test (`__tests__/integration.test.ts`) writes the scaffolded YAML
and runs `caia-chain init` + `next-phase` to prove it dispatches.

## Tests

```sh
pnpm -C packages/chain-scaffolder test
```

`__tests__/integration.test.ts` picks the first `⏳ pending [INDEPENDENT]` item
from `~/Documents/projects/backlog/MASTER_BACKLOG.md` (falling back to a
synthetic item when the backlog is absent), runs it through the full
scaffolder pipeline with a fixture provider, and exercises `caia-chain init`
+ `next-phase --read-only` against the result.

[@chiefaia/chain-runner]: ../chain-runner
[local-llm-router]: ../local-llm-router
