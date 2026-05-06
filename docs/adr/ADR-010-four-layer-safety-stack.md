# ADR-010 — 4-layer safety stack

## Status

**Accepted** — shipped 2026-04-30 (PRs #201, #205, #206). Operator-authorised standing rule.

## Context

Autonomous agents executing tools on behalf of an LLM present compounding safety surfaces:

1. **Tool-side** — MCP supply chain has known systemic vulnerabilities (April 2026 OX disclosure of command-injection RCE in Anthropic's official MCP SDK; Anthropic declined to patch).
2. **LLM-side** — every tool return value can carry adversarial prompt-injection payloads.
3. **Capability-side** — irreversible actions (file delete, deploy, push to main) need explicit authorisation.
4. **Spend-side** — runaway agents could drain subscription bucket without bound.

Off-the-shelf approaches (Anthropic's `--permission-mode bypassPermissions`, naive sandbox) are inadequate at the level CAIA operates at. Per `safety_hardening_2026-04-29.md` and `mcp_security_threat_landscape_2026-04-29.md`, the operator authorised filing a four-layer defensive stack.

## Decision

CAIA's safety stack is four cooperating packages:

### Layer 1 — Capability Broker (`@chiefaia/capability-broker`)

- HMAC-signed capability tokens, 5-minute TTL
- 5-second irreversible-action delay (cancel window)
- Ledger persisted to `irreversible_actions` table (audit trail)
- Hook-controlled-mode adapter — replaces `--permission-mode bypassPermissions` with explicit per-action authorisation
- Every irreversible action (write to disk, deploy, push) flows through broker

### Layer 2 — MCP Allowlist Proxy (`@chiefaia/mcp-allowlist-proxy`)

- Per-MCP policy file (`policies/<name>.json`):
  - Pinned upstream commit SHA
  - Per-tool argument constraints (regex / enum / maxLength / forbid patterns)
  - Per-task `maxPerTask` budgets
- Spawn-command allowlist: `{npx, uvx, python, python3, node, docker, deno}` only
- Rejects 0.0.0.0 / [::] binds (no externally exposed services from MCP)
- macOS `sandbox-exec` profile applied to MCP server processes
- Vendored + commit-pinned MCPs only (supply-chain hardening)

### Layer 3 — Tool Output Sanitizer (`@chiefaia/tool-output-sanitizer`)

- Strips role-impersonation markers, zero-width Unicode, ANSI escapes
- Flags ignore-previous-instructions variants, jailbreak templates, tool-redefinition payloads
- OWASP LLM Top-10 corpus (12 seed samples; expanded continuously by Mentor)
- Wraps every MCP tool return + every fetched-content payload before LLM ingestion

### Layer 4 — Spend Guard (`@chiefaia/spend-guard`)

- 4-tier caps:
  - Per-task: $1.50/day
  - Per-project: $30/week
  - Global day: $25/day
  - Global week: $100/week
- Auto-pause on cap breach
- Account-pool with 2 Max subscriptions, serial fallback
- 80%-of-cap threshold biases router to Ollama (preventive)
- ToS-aware warning at startup (multi-Max usage tracked)

Plus complementary safety surfaces (not part of the 4-layer stack but cooperating):
- HashiCorp Vault for secrets (ADR-014)
- Evidence Gate at PR merge (ADR-011)
- Steward Gatekeeper (ADR-012)
- Subscription-only billing (ADR-007)

## Consequences

**Positive:**
- 10 CVEs addressed in initial ship (per `safety_hardening_2026-04-29.md`).
- Composable: each layer is independently testable; one failure does not cascade.
- Mitigates the April 2026 MCP supply-chain RCE class without waiting on Anthropic patch.
- Capability ledger gives operator and Steward an auditable history.
- Spend cap is enforceable in real time, before catastrophic drain.

**Negative:**
- Latency cost — each tool call passes through allowlist + sanitizer.
- Maintenance burden — policy files require updating on MCP version bumps.
- Adversarial-injection corpus has only 12 seed samples; continuous expansion required (Mentor surfaces real-world payloads).

**Neutral:**
- Stack composes with future productisation security additions (per-tenant capability isolation, SBOM, SLSA Level declaration) — Security Architect Agent owns the next layer.

## Re-evaluation triggers

1. **New attack class** — disclosed CVE that bypasses any one layer requires re-evaluation of that layer's implementation.
2. **Productisation** — tenant isolation requires per-tenant capability scopes; extends Capability Broker.
3. **Performance regression** — if sanitizer or allowlist proxy introduces >100ms p95 overhead per tool call, re-tune.

## References

- Standing rule: `agent/memory/safety_hardening_2026-04-29.md`
- MCP threat landscape: `agent/memory/mcp_security_threat_landscape_2026-04-29.md`
- Implementing PRs: #201 (capability-broker), #205 (mcp-allowlist-proxy + sanitizer), #206 (spend-guard)
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §4.4
- Companion ADRs: ADR-007 (subscription-only), ADR-011 (Evidence Gate), ADR-012 (Steward Gatekeeper), ADR-014 (Vault)
