# ADR-011 — Evidence Gate at PR merge

## Status

**Accepted** — operator-authorised standing rule (2026-04-29). Operational in production GitHub Actions.

## Context

Autonomous Claude PRs land at high cadence. Without a deterministic pre-merge gate, regressions, secrets, and architectural violations leak through. Manual review by the operator is impossible at this throughput (and operator does not code per `feedback_operator_does_not_code.md`).

The Evidence Gate is the deterministic, machine-checkable substitute for human PR review. Every Claude-authored PR must pass the same set of checks before merge into `develop`.

## Decision

Six contexts are **required** (blocking) at PR merge. Three are **warn-only**.

### Required (blocking) contexts

| # | Context | What it checks |
|---|---|---|
| 1 | `Build·Test·Lint·Typecheck` | Compiles, lints, typechecks, all unit tests pass |
| 2 | `gitflow-conformance` | Branch source target conforms to Git Flow rules (per ADR-015): feature/* → develop only; release/* → develop and main; main accepts only release/* and hotfix/* |
| 3 | `typecheck` | Workspace-wide TypeScript typecheck (`tsc --noEmit`) |
| 4 | `semgrep` | Custom CAIA rules in `.semgrep/caia-rules.yml` (Option E gates, capability-broker-bypass detection, etc.) |
| 5 | `gitleaks` | Secret-leak scanner (no plaintext credentials in any committed file) |
| 6 | `bundle-size` | size-limit: ≤500KB total bundle, ≤200KB first-load (dashboard + sites) |

### Warn-only contexts

| # | Context | What it surfaces |
|---|---|---|
| 7 | `lighthouse` | Performance regression vs baseline (warn, do not block) |
| 8 | `axe` | Accessibility regression vs baseline (warn) |
| 9 | `visual` | Visual diff vs baseline screenshots (warn) |

Warn-only contexts surface but do not block — the operator and Curator review trends, but a single warning does not stall a PR.

### Adversarial-injection corpus

Adversarial-injection regression suite is mandatory per Definition of Done item 15. Corpus seeded with 12 OWASP LLM Top-10 samples; continuously expanded by Mentor on every classified incident.

### Doc-only PR carve-out

Doc-only PRs (zero code changes; only `*.md`, no `package.json` change, no source files modified) may relax some required contexts: `bundle-size`, `axe`, `lighthouse`, `visual` are skipped automatically. `Build·Test·Lint·Typecheck`, `gitflow-conformance`, `semgrep`, `gitleaks` still block.

## Consequences

**Positive:**
- PR merges are deterministic — green = mergeable, no human review required.
- Regressions caught at gate, not in production.
- Operator's "validate visual outputs only" stance preserved (no PR review).
- Doc-only carve-out keeps quick-wins documentation cluster moving.

**Negative:**
- Gate run time is ~3-5 minutes per PR (not free).
- Flaky checks (e.g., visual snapshot drift) require periodic recalibration.
- Strict semgrep rules occasionally false-positive; suppression requires documented inline rationale.

**Neutral:**
- Gate composes with Steward Gatekeeper (ADR-012) at additional surfaces (daily, weekly, pre-spawn).

## Enforcement

- GitHub branch protection: `develop` and `main` require all six required contexts green before merge.
- Evidence Gate workflow: `.github/workflows/evidence-gate.yml`.
- Custom semgrep rules: `.semgrep/caia-rules.yml`.
- Operator runbook: [`evidence-gate.md`](../evidence-gate.md).

## Re-evaluation triggers

1. **Gate flake rate >5%** sustained over 4 weeks → tighten flaky checks or move to warn-only.
2. **New vulnerability class** (e.g., supply-chain-side) requires a new required context.
3. **Productisation** — tenant-isolation rules add a new required context.
4. **Performance regression** — gate p95 >10 minutes triggers parallelisation work.

## References

- Standing rule: `agent/memory/evidence_gate_2026-04-29.md`
- Operator runbook: `caia/docs/evidence-gate.md`
- Implementing workflow: `.github/workflows/evidence-gate.yml`
- Custom semgrep rules: `.semgrep/caia-rules.yml`
- Definition of Done: `agent/memory/feedback_definition_of_done.md`
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §4.4 + §8.3
- Companion ADRs: ADR-005 (Test-Fix-Commit), ADR-010 (4-layer safety stack), ADR-012 (Steward Gatekeeper), ADR-015 (Git Flow)
