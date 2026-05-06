# Option E Per-Agent Audit Status

Tracks Option E (CAIA-Bonded Skeleton, standing rule 2026-05-06) compliance for every agent in `packages/`. The standing rule itself lives at `agent/memory/agent_architecture_shape_2026-05-06.md`. The audit dimensions per `~/Documents/projects/reports/agent-architecture-strategic-decision-2026-05-06.md` §8.5.

For each agent we check the five mechanical gates from the standing rule:

1. **Private package** — `package.json` has `"private": true` and scope `@chiefaia/<name>`
2. **Parameterised public API** — every CAIA-specific path/topic/registry is a constructor parameter with a CAIA default; no hard-coded literals in code paths
3. **Fixture-corpus tests** — tests inject fake/fixture corpora; never touch live `~/Documents/projects/caia/agent/memory/`
4. **Pre-spawn injection consumed** — agent reads task prompts after Mentor + Librarian retrieval has prepended relevant lessons + precedent (only applicable to LLM-driven agents)
5. **No second-customer abstraction** — configuration matrix is exactly one (CAIA); no config files, no multi-tenant API, no OSS-style docs

`N/A` is a valid outcome for gate 4 when an agent is purely deterministic and makes no LLM calls — pre-spawn injection has no surface to attach to in that case. When the agent later grows an LLM-synthesis surface, the gate becomes load-bearing.

## Status table

| Agent | Gate 1 | Gate 2 | Gate 3 | Gate 4 | Gate 5 | Notes |
|---|---|---|---|---|---|---|
| `@chiefaia/mentor-retrieval` | ✓ | ✓ | ✓ | ✓ | ✓ | Already in Option E shape (Phase-3 build). Reference exemplar. |
| `@chiefaia/librarian` | ✓ | ✓ | ✓ | ✓ | ✓ | Already in Option E shape (Phase-1 build). Mem0 swap is orthogonal. |
| `@chiefaia/curator` | ✓ | ✓ | ✓ | N/A | ✓ | See "Curator audit" below. |
| `@chiefaia/system-prompt-block` | ✓ | ✓ | ✓ | N/A | ✓ | Lead-by-example for Option E codification work. |

`@chiefaia/apprentice-*` packages are not yet built (Phase 0 paused at Stage 1; resume scope explicitly applies Option E to all five sub-packages).

## Curator audit (2026-05-06)

**Outcome**: clean — no remediation required.

### Gate 1 — Private + @chiefaia scope

✓ `packages/curator/package.json`:

```json
{
  "name": "@chiefaia/curator",
  "version": "0.1.0",
  "private": true,
  ...
}
```

The forthcoming `caia-option-e-package-must-be-private` semgrep rule passes on this file.

### Gate 2 — Parameterised public API

✓ `packages/curator/src/types.ts` exposes `ScanContext` with explicit fields:

- `repoRoot: string`
- `memoryDir: string`
- `reportsDir: string`
- `runShell: (cmd: string, args: string[]) => string` — injectable shell runner
- `env?: Record<string, string | undefined>` — injectable env access
- `now?: () => Date` — injectable clock

✓ `packages/curator/src/context.ts` — `defaultScanContext(opts: DefaultContextOptions = {})` accepts `repoRoot` / `memoryDir` / `reportsDir` overrides, falls back to `$CAIA_MEMORY_DIR` / `$CAIA_REPORTS_DIR`, then to `process.cwd()` and `<homedir>/Documents/projects/reports`.

The literal `Documents/projects/reports` lives only inside the default-fallback expression of a parameterised constructor — not anywhere else in the code paths. This satisfies gate 2: tests can override every path; the literal is a CAIA default, not a load-bearing assumption.

The forthcoming `caia-option-e-no-env-home-caia-path` and `caia-option-e-no-hardcoded-caia-path-literal` semgrep rules pass on this file (the path target `/Documents/projects/reports` is general, not the `/Documents/projects/caia` repo path the rule guards against).

### Gate 3 — Fixture-corpus tests

✓ `packages/curator/tests/scanners.test.ts`:

```ts
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'curator-scanners-test-'));
});

function mkCtx(overrides = {}, shellMock?) {
  return {
    repoRoot: tmp,
    memoryDir: join(tmp, 'memory'),
    reportsDir: join(tmp, 'reports'),
    runShell: shellMock ?? (() => ''),
    env: {},
    now: () => new Date('2026-05-05T01:00:00Z'),
    ...overrides
  };
}
```

Tests construct synthetic memory directories under `os.tmpdir()`, mock `runShell`, and never touch the live operator session-memory paths. The same shape is mirrored across `tests/orchestrator.test.ts`, `tests/digest.test.ts`, `tests/cli*.test.ts`.

### Gate 4 — Pre-spawn injection consumed

`N/A` for the current Phase-1/Phase-2 surface. Curator scanners are pure deterministic functions — no LLM calls, no spawned tasks. There is no surface for Mentor + Librarian pre-spawn injection to attach to.

When Curator's industry-briefing scanner or future synthesis-style emitters add LLM-driven generation (post-Mentor Phase-4 / post-Librarian Phase-2), this gate becomes load-bearing — those callsites must consume `mentor-retrieval` prepend + `librarian` retrieval before generating. Add to the Option E re-audit checklist at that time.

### Gate 5 — No second-customer abstraction

✓ Configuration matrix is one (CAIA). No `.curatorrc.yml`, no plugin discovery, no public-OSS docs surface. The `@chiefaia/curator` scope is private workspace; nothing in the codebase suggests a second consumer.

## Re-audit triggers

This audit is valid until any of:

1. The Curator package adds an LLM-synthesis surface (industry-briefing scanner reaches LLM-driven Phase-3, or any other emitter starts generating prose) — re-audit gate 4
2. A new scanner is added that hard-codes a CAIA path (semgrep would block this; if a regression slips, re-audit gate 2)
3. Curator publishes anything to public npm (would violate gate 1; semgrep would block)
4. Curator is invoked from outside CAIA (would force gate 5 re-evaluation; today: no consumers)

Quarterly Curator self-review (already running per `curator_agent_directive.md`) carries an Option E re-audit checklist as part of its cadence.

## See also

- `agent/memory/agent_architecture_shape_2026-05-06.md` — standing rule
- `agent/memory/feedback_agent_architecture_option_e.md` — Mentor seed lesson
- `agent/memory/curator_agent_directive.md` — Curator's own backlog directive
- `~/Documents/projects/reports/agent-architecture-strategic-decision-2026-05-06.md` §8.5 — backward-compat migration plan per agent
- `AGENTS.md` — project conventions
- `.semgrep/caia-rules.yml` — Option E enforcement rules (`caia-option-e-*`)
