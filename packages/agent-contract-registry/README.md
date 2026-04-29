# `@chiefaia/agent-contract-registry`

The Agent Section Contract Registry — declarative store of per-agent contracts (PO/BA/EA/Test-Design) plus the `composeTemplate(scope)` function. The Story Validator consumes the runtime-composed template instead of a hard-coded rubric, so adding a new agent is just registering a contract — no Validator change.

## Why

Each ticket-writing agent declares a `SectionContract` listing the sections it populates with per-scope rubrics. The Validator unions those contracts at runtime per a story's `story_scope` (initiative → epic → module → story → task → subtask) and uses the composed template as its rubric.

End state: every story is **self-sufficient, stateless, context-less** — Test-Design + coding agents get everything from the ticket alone.

## Usage

```typescript
import { register, composeTemplate } from '@chiefaia/agent-contract-registry';
import { poAgentContract } from './po-agent.contract';
import { baAgentContract } from './ba-agent.contract';

register(poAgentContract);
register(baAgentContract);

const template = composeTemplate('story');
//   ^^^^^^^^^^ ComposedTemplate { scope, sections, signature, warnings }

for (const [sectionName, entry] of template.sections) {
  console.log(`${sectionName} owned by ${entry.ownerAgent}`);
}
```

## API

- `register(contract)` — add to the singleton registry. Throws on duplicate.
- `getDefaultRegistry()` — singleton instance for advanced use.
- `composeTemplate(scope, opts?)` — pure compose function. `opts.strict` throws on conflict; `opts.registry` overrides the singleton (tests).
- `composeAllScopes(opts?)` — convenience returning `Record<StoryScope, ComposedTemplate>`.

## Composition algorithm

1. Filter registry to contracts whose `appliesTo` includes `scope`.
2. Sort by agent-pipeline order — `PO < BA < EA < Test-Design`. Tie-break alphabetically by `contractId`.
3. Iterate sections; first contract claiming a section name wins. Subsequent claims log a warning (or throw in strict mode).
4. Apply per-section `scopeOverrides[scope]` (shallow rubric merge + optional `required` override).
5. Verify each section's `dependencies` resolve within the composed template; warn for unresolved.
6. Compute a stable SHA-256 `signature` over the composed entries.

## Performance

`composeTemplate` is pure data manipulation — zero LLM calls. Benchmarked at 24k–92k ops/sec per scope on the full 4-agent contract set (mean < 0.05 ms). The Validator caches results keyed on `signature`.

## See also

- `@chiefaia/ticket-template` — `SectionContract`, `StoryScope`, `ComposedTemplate` types.
- `~/Documents/projects/reports/agent-contract-registry-architecture-2026-04-28.md` — full architecture report.
- `caia/docs/agent-contracts.md` — operator-facing pattern doc (ACR-011).
