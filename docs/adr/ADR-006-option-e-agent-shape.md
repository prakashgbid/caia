# ADR-006 — Option E agent architecture shape (CAIA-Bonded Skeleton)

## Status

**Accepted** — operator-authorised 2026-05-06. Standing rule.

Supersedes prior ad-hoc per-agent shape decisions. Re-evaluation triggers at end of file.

## Context

CAIA ships agents at increasing cadence. Without a shared shape, every new agent re-litigated "should this be generic or hard-coded for CAIA?" Five candidate shapes were on the table:

- **Option A** — pure-generic, OSS-publishable. Maximises reusability; forfeits CAIA-specific velocity. Rejected: open-source is not a priority.
- **Option B** — pure-CAIA, hard-coded. Maximises velocity short-term; forfeits testability and refactor velocity over time.
- **Option C** — hybrid, parameterised, framed for eventual open-source. Closest to industry SOTA but with a premium for an OSS path that is not on the roadmap.
- **Option D** — per-agent decision. Cop-out — reproduces the original problem.
- **Option E** — parameterised + private + project-bonded at runtime. Industry SOTA pattern (Cursor, Aider, Augment Code, Sourcegraph Cody, Devin all converge here).

Background research: 67-source meta-analysis at `~/Documents/projects/reports/agent-architecture-strategic-decision-2026-05-06.md`. Validated against the broader CAIA approach in `~/Documents/projects/reports/caia-approach-validation-meta-research-2026-05-05.md`.

## Decision

Every CAIA agent built from this point forward ships as a **private `@chiefaia/*` workspace package** in the caia monorepo, parameterised at the constructor with CAIA-default values, project-bonded at runtime via Mentor + Librarian pre-spawn injection + AGENTS.md + system-prompt block + (eventually) Apprentice adapter.

Mechanical gates on every new agent:

1. **Lives at `packages/<agent-name>/`** — not a separate repo, not under `apps/`.
2. **`package.json` has `"private": true`** and scope `@chiefaia/<agent-name>`.
3. **Public API is parameterised** — every CAIA-specific path / topic / registry / integration is a constructor parameter with a CAIA default.
4. **Tests inject fixture corpora**, not live CAIA paths. If a test requires live paths, parameterisation is broken.
5. **Pre-spawn injection via Mentor + Librarian** is consumed (not bypassed).
6. **AGENTS.md at repo root** is consulted for project conventions.
7. **NEVER published** to public npm — configuration matrix is exactly one (CAIA).

Project-bonding mechanism:

- Mentor pre-spawn lesson injection (shipped, Phase 4)
- Librarian nearest-neighbour precedent retrieval (shipped, Phase 1)
- `AGENTS.md` auto-read at task start (shipped via PR #346)
- `@chiefaia/system-prompt-block` ≤1K-token CAIA primer (shipped via PR #347)
- Apprentice-trained LoRA adapter (Phase 3-4 future work)

The agent's **code** is generic-shape (parameterised, testable, refactorable). The agent's **reasoning context** is narrowed to CAIA on every spawn.

## Consequences

**Positive:**
- One canonical shape for every new agent → no per-agent re-litigation, faster spawn velocity.
- Tests stay isolated from CAIA-specific paths → refactor velocity preserved.
- Productisation pivot (if it happens) is mechanical — swap defaults at construction time, no rewrite.
- Compatible with current 4 in-flight agents (Mentor, Curator, Librarian, Apprentice all already in this shape or trivially convertible).
- Steward semgrep rule (PR #347) enforces gates 1-3 mechanically.

**Negative:**
- Slightly more design overhead per agent (parameterisation up front) than pure-CAIA-hard-coded would be.
- Productisation re-evaluation eventually required if multi-tenant signs paying customer (re-evaluation trigger #1).

**Neutral:**
- No backward-compat migration cost — all current agents already match.
- Consumed-OSS posture unchanged — Aider, Promptfoo, Mem0, Claude Code subagents all stay external dependencies.

## Re-evaluation triggers

Any one fires → re-open this decision:

1. **Productisation trigger** — operator decides to multi-tenant CAIA AND signs ≥1 paying tenant or LOI within 90-day onboarding runway.
2. **Second-internal-consumer trigger** — a NEW project (not Stolution, not existing websites) appears AND wants to consume an existing CAIA agent.
3. **OSS-pivot trigger** — operator strategic pivot signals open-source as a priority.
4. **Bonding-mechanism failure trigger** — Mentor/Librarian/Apprentice fail to deliver project-bonding gains ≥10% on Promptfoo canonical eval.
5. **Cost-explosion trigger** — subscription-bucket consumption per agent invocation grows to ≥2× baseline (parameterisation overhead too heavy).

## References

- Standing rule: `agent/memory/agent_architecture_shape_2026-05-06.md`
- Decision report: `~/Documents/projects/reports/agent-architecture-strategic-decision-2026-05-06.md`
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §11.5
- Related ADRs: ADR-001 (Living Library), ADR-002 (App Code Purity), ADR-004 (Agent-First)
- Implementing PRs: #346 (AGENTS.md), #347 (system-prompt-block + semgrep)
