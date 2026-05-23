# @caia/architect-kit

The interface kit every one of CAIA's 17 specialist architects implements.

## What's here

- **`SpecialistArchitect` interface** — the polymorphic contract the EA Dispatcher consumes (`name`, `sectionContract`, `systemPrompt()`, `tools`, `run()`).
- **`BaseArchitect` abstract class** — reduces per-architect boilerplate (`okOutput`, `partialOutput`, `failedOutput`, `missingPaths`, `extraPaths`, `zeroSpend`).
- **`ArchitectSectionContract`** — disjoint-write contract over `tickets.architecture` JSONB. Each contract declares the JSON paths it owns, its precedence rank, its `dependsOn` set, and an `appliesPredicate(ticket)` filter.
- **`ArchitectRegistry`** — process-local store of all registered architects. Validates path-disjointness on every register. The dispatcher iterates `applicableTo(ticket)` to derive the active set.
- **`computeWaves()`** — Kahn's algorithm over the `dependsOn` graph. Returns wave layers the dispatcher fans out in parallel.
- **`CANONICAL_PRECEDENCE_LADDER`** — the 17-element ranking used by the dispatcher's semantic-conflict resolver.
- **`caia-architect-new` CLI** — scaffolds a new `<name>-architect` package with a working stub and tests.

## Quick scaffold

```bash
pnpm caia-architect-new \
  --name analytics \
  --depends-on frontend \
  --precedence 10 \
  --writes "analytics.provider,analytics.eventTaxonomy" \
  --runtime-model sonnet
```

Generates `packages/analytics-architect/` with `package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`, `src/{index,contract,architect,system-prompt.md}.ts`, and passing tests under `tests/`.

## Implementing a custom architect

```ts
import { BaseArchitect, type ArchitectSectionContract } from '@caia/architect-kit';

const MyContract: ArchitectSectionContract = {
  contractId: 'my-architect.v1',
  architectName: 'my',
  version: '0.1.0',
  sections: [
    { path: 'my.foo', description: 'the foo field', required: true },
  ],
  architectMeta: {
    dependsOn: [],
    precedenceLevel: 50,
    fanoutPolicy: 'always',
    appliesPredicate: (ticket) => ticket.type === 'Page',
    runtimeModel: 'sonnet',
  },
};

export class MyArchitect extends BaseArchitect {
  readonly name = 'my';
  readonly sectionContract = MyContract;
  async run(input) {
    // Call your LLM here. Return ok/partial/failed output.
    return this.okOutput({ 'my.foo': 'bar' }, { confidence: 0.9 });
  }
}
```

## Spec

Sourced from `research/17_architect_framework_spec_2026.md` (§1 Interface, §2 Roster + Waves, §5 Conflict Resolution, §8 CLI).
