# ADR-014 — HashiCorp Vault for secrets

## Status

**Accepted** — operational. Vault running in Docker on stolution.

## Context

CAIA accumulates secrets at scale: GitHub PAT, Anthropic OAuth tokens, Vault AppRole credentials, OpenAI / Replicate keys (training-only), Cloudflare API keys, GA4 service accounts, Stolution database credentials, Postgres passwords, Loki/Grafana basic-auth.

Storing secrets in `.env` files, plaintext config, or worse, in committed code, is unacceptable. The 2026-04-29 chaos audit confirmed that an unbounded plaintext-secret pattern would compound rapidly.

Three categories of solution were considered:
- **Cloud SaaS** (AWS Secrets Manager, Doppler, 1Password Connect) — paid; vendor lock-in; not under operator control.
- **Native (Mac Keychain only)** — Mac-only; doesn't work for stolution server; no audit log.
- **HashiCorp Vault self-hosted** — free, audited, KV v2 versioning, AppRole pattern for autonomous reads, audit log shippable to Loki.

`feedback_pat_topic.md` documents the operator's explicit position: post-rotation plaintext copies in operational locations (.bashrc, .env, docker config, plist) are intentional ergonomic copies and are NOT to be re-flagged. The canonical secret store is Vault; operational copies are downstream conveniences.

## Decision

HashiCorp Vault is the canonical secret store. Specifically:

- **Server**: Vault in Docker container on stolution server.
- **Backend**: KV v2 (versioned).
- **Mount paths**:
  - `secret/stolution/prod/*` — production stolution secrets
  - `secret/stolution/staging/*` — staging stolution secrets
  - `secret/stolution/prod/infrastructure` — GitHub PAT and infrastructure tokens
  - `secret/caia/*` — CAIA-specific secrets
- **Authentication**: AppRole pattern for autonomous agent reads (RoleID + SecretID).
- **Policies**: 7 policies, 3 AppRoles. Each agent role has minimum-privilege scope.
- **Audit log**: shipped to Loki.
- **Unseal keys**: backed up off-server in macOS Keychain.
- **Snapshots**: daily Vault snapshot to `/home/s903/backups/vault/`; 30d retention; off-server rsync to Mac at `~/Library/Application Support/Stolution/vault-snapshots/` (LaunchAgent `com.stolution.vault-snapshot-pull`); quarterly restore drill via `~/stolution/scripts/backup/test-vault-restore.sh`.

Operational-copy carve-out (per `feedback_pat_topic.md`):
- Plaintext tokens in `.bashrc` / `.env` / `docker-config` / `plist` are **intentional** post-rotation ergonomic copies.
- Do NOT propose moving these to Vault.
- Do NOT call them security findings.
- The canonical source is always Vault; operational copies are downstream conveniences and are rotated when Vault rotates.

## Consequences

**Positive:**
- Audit log gives full trail of every secret access (Vault → Loki → Grafana dashboard).
- KV v2 versioning allows rollback after compromise.
- AppRole pattern enables autonomous agent reads without human-in-loop.
- Self-hosted = no vendor cost, no vendor lock-in.
- Off-server unseal-key backup means catastrophic stolution loss does not lose the vault.

**Negative:**
- Vault is a single point of failure — if it's down, agents can't read secrets.
- Operational complexity — initialise, unseal, rotate, audit.
- Quarterly restore drill must actually be run (Steward failure mode #7).

**Neutral:**
- Productisation may require per-tenant Vault namespaces — extension, not rewrite.

## Operational rules

- **Read pattern**: agents authenticate via AppRole login → fetch secret → cache in process memory only (never persist to disk outside Vault).
- **Rotation cadence**: GitHub PAT every 90 days; Anthropic tokens per their TTL; Vault unseal keys never rotated (only re-encrypted via `operator rekey`).
- **Backup verification**: Steward failure mode #7 surfaces a stale or empty vault snapshot.

## Re-evaluation triggers

1. **Vault availability becomes a hot path constraint** — if agent spawn latency is dominated by Vault round-trip, evaluate per-agent secret caching with TTL.
2. **Productisation** — multi-tenant secret isolation requires per-tenant Vault namespaces.
3. **Vault project becomes problematic** (license change, abandonment) → evaluate OpenBao fork.

## References

- Standing rule: `agent/memory/secrets_vault.md`
- Standing rule: `agent/memory/feedback_pat_topic.md`
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.2 + §4.4
- Backup runbook: `caia/docs/test-isolation-runbook.md` (cross-references Vault drill)
- Companion ADRs: ADR-007 (subscription-only LLM), ADR-010 (4-layer safety stack)
