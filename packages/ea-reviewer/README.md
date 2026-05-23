# @caia/ea-reviewer

Critic-style audit for the composed `tickets.architecture` JSONB. Drives the third stage of the EA fan-out phase: the dispatcher produces composed architecture; the reviewer either passes it (ticket → `ea-complete-verified` → Test Author) or rejects it with a per-architect rerun list (ticket → `ea-rejected` → dispatcher re-runs only the named architects, max 3 iterations).

## Three audit lenses

- **Completeness** — every required `SectionContract.section` path must be populated non-null. Missing fields surface as P1 rerun directives on the owning architect.
- **Consistency** — ~15 cross-architect invariants (every endpoint has a rate limit, every interactive widget has a keyboard spec, every A/B variant binds to a real flag, …). Each invariant names the architect to blame.
- **Correctness** — acceptance-criteria alignment via a `CriticAdapter` (DI seam). Three adapters ship: `NullCriticAdapter` (test), `HeuristicCriticAdapter` (deterministic keyword-overlap heuristic), and `FixedCriticAdapter` (canned findings). Production wires this to a Claude subagent via `@chiefaia/claude-spawner`.

## Decision envelope

```ts
{
  decision: 'pass' | 'fail',
  finalState: 'ea-complete-verified' | 'ea-rejected',
  rerunArchitects: RerunDirective[],   // ← dispatcher consumes this
  advisories: Advisory[],              // ← dashboard surfaces these
  findings: { completeness, consistency, correctness },
  summary: string,
}
```

## Spec

Sourced from `research/17_architect_framework_spec_2026.md` §6.
