# Architecture Decision Records (ADRs)

This directory holds CAIA's canonical Architecture Decision Records. ADRs are short, format-formalised statements of *why* a load-bearing decision was made. They sit alongside `agent/memory/*.md` (the operator-curated standing rules) and `caia_architecture.md` (the consolidated architecture reference) and serve as the durable decision-precedent surface.

## Format

Every ADR has five sections:

1. **Status** — `Accepted`, `Superseded by ADR-NNN`, `Deprecated`, or `Proposed`
2. **Context** — what problem made the decision necessary
3. **Decision** — what we decided
4. **Consequences** — what follows (positive + negative + neutral)
5. **References** — links to memory, reports, code

## Index

| ADR | Title | Status |
|---|---|---|
| ADR-001 | Living Library | Accepted (memory: `caia_architecture.md`) |
| ADR-002 | Application Code Purity | Accepted (memory: `caia_architecture.md`) |
| ADR-003 | Event-First | Accepted (memory: `caia_architecture.md`) |
| ADR-004 | Agent-First | Accepted (memory: `caia_architecture.md`) |
| ADR-005 | Test-Fix-Commit Cadence | Accepted (memory: `caia_architecture.md`) |
| [ADR-006](ADR-006-option-e-agent-shape.md) | Option E agent architecture shape (CAIA-Bonded Skeleton) | Accepted |
| [ADR-007](ADR-007-subscription-only-llm.md) | Subscription-only LLM billing (no API keys) | Accepted |
| [ADR-008](ADR-008-mac-first-inference.md) | Mac-first inference (Ollama bulk + claude binary synthesis) | Accepted |
| [ADR-009](ADR-009-custom-hono-runtime.md) | Custom Hono runtime over LangChain/CrewAI/MS Agent Framework | Accepted |
| [ADR-010](ADR-010-four-layer-safety-stack.md) | 4-layer safety stack | Accepted |
| [ADR-011](ADR-011-evidence-gate.md) | Evidence Gate at PR merge | Accepted |
| [ADR-012](ADR-012-steward-gatekeeper.md) | Steward Gatekeeper (15 enumerated failure modes) | Accepted |
| [ADR-013](ADR-013-single-threaded-write-per-worktree.md) | Single-threaded write per worktree | Accepted |
| [ADR-014](ADR-014-hashicorp-vault.md) | HashiCorp Vault for secrets | Accepted |
| [ADR-015](ADR-015-git-flow-enforcement.md) | Git Flow enforcement (feature → develop → main) | Accepted |

## Maintenance

Today: ADRs are filed by Claude as load-bearing decisions are made. Going forward, **Docs Architect Agent** (master sequencing item 13.5) owns this register and gates new ADR proposals through the Evidence Gate.

ADR-001 through ADR-005 are inherited from earlier consolidation work (`caia_architecture.md`). ADR-006 onwards are filed in this directory in standalone form.
