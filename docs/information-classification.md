# Information Classification

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.2.2 + §3.2.3.
> **Maintenance**: today Claude maintains; Data Architect Agent (master sequencing item 14.6) takes over going forward.

This document formalises the four-class information classification CAIA uses today, plus the lifecycle policies per class.

## Classification

| Classification | Examples | Storage | Access |
|---|---|---|---|
| **Public** | OSS package documentation, public sites' content | Git public (caia GH repo) | Anyone |
| **Internal** | Memory files, reports, ADRs, design docs | Mac filesystem + private git | Operator + Claude |
| **Secret** | Vault contents, AppRole creds, GitHub PAT, OAuth tokens | Vault + Mac Keychain (off-server backup only) | Vault AppRole + macOS Keychain |
| **Regulated** (productisation) | Future PII, payment data, GDPR-scoped tenant data | Encrypted + access-logged + retention-bound | Productisation phase only |
| **Sensitive (legacy)** | Plaintext tokens in operational locations (.bashrc, .env, docker config, plist) | Mac filesystem | Operator (intentional post-rotation copies; per `feedback_pat_topic.md` do NOT re-flag) |

## Per-class handling rules

### Public

- May be committed to the public CAIA monorepo (`prakashgbid/caia`).
- May be displayed in screenshots, dashboards, demo videos.
- No special handling.

### Internal

- Lives on operator's Mac and in the caia private monorepo (when migrated to private). Currently caia is public; sensitive memory files live OUTSIDE the repo at `~/Library/Application Support/Claude/local-agent-mode-sessions/.../agent/memory/`.
- Reports under `~/Documents/projects/reports/` are operator-private.
- May NOT be committed to public sites' repos.
- May be referenced in PR descriptions by path.

### Secret

- Canonical store: HashiCorp Vault on stolution (per ADR-014).
- Read pattern: agents authenticate via AppRole login → fetch → cache in process memory only.
- May NEVER be committed to any repo.
- May NEVER appear in PR descriptions, log lines (logger redacts), or Cowork chat.
- gitleaks at Evidence Gate (ADR-011) blocks any Secret-class string from merging.
- Off-server unseal-key backup in macOS Keychain.

### Regulated (productisation phase)

- Out of scope today (operator-only mode).
- At first paying tenant: PII / payment / GDPR-scoped data lives in encrypted-at-rest stores, access-logged, retention-bound per regulation.
- Compliance Agent (item 18.7) owns at productisation.

### Sensitive (legacy)

- Plaintext tokens in operational locations are **intentional** post-rotation ergonomic copies.
- Canonical source is always Vault; copies are downstream conveniences and rotate when Vault rotates.
- Per `agent/memory/feedback_pat_topic.md`: do NOT propose moving these to Vault, do NOT call them security findings.

## Information lifecycle

For each information class, the lifecycle is **CREATE → STORE → TRANSFORM → RETRIEVE → ARCHIVE → DELETE**.

| Class | Create | Store | Transform | Retrieve | Archive | Delete |
|---|---|---|---|---|---|---|
| Memory MD | Operator/Claude writes file | Filesystem | Mentor reads/writes; Librarian indexes | Pre-spawn injection | None | Manual via consolidation |
| Mentor incidents | Event-driven capture | sqlite | Classified into 18-category taxonomy | Pre-spawn injection | Quarterly self-review prunes | Never (lessons compound) |
| Reports | Claude/agents author | Filesystem | Apprentice corpus aggregator distills | Operator review; Librarian indexes | Year-old reports → archive subdir | Never (audit value) |
| Pipeline state | API endpoint writes | Postgres + Drizzle | Stages advance via ADR-003 events | Dashboard + executor poll | Old completed prompts → archived flag | Audit log preserves |
| Telemetry | Auto-emitted | Langfuse + Loki + Tempo | Sampled per Lantern config | Grafana dashboards | Time-bounded retention | Auto-deleted after retention |
| Secrets | Operator + agents | Vault | Rotated periodically | AppRole login | Vault audit log preserves access trail | Versioned in KV v2; old versions kept |
| AKG | ts-morph extraction | Postgres + sqlite-vec | Re-extracted incremental on PR merge | EA Agent at story stage | Old artifacts marked deprecated | Manual cleanup |
| Vector embeddings | nomic-embed-text via Ollama | sqlite-vec | Re-embedded on source change | Cosine + RRF hybrid search | None | Recomputed in place |
| Training corpus | Apprentice aggregator | Filesystem (versioned) | Curated, dedupe, PII-mask, distilled | Apprentice training jobs | 90-day TTL | Auto-purged at TTL |
| Model adapters | Apprentice training | Filesystem (versioned) | Eval against canonical suite | Ollama serving (active adapter) | Replaced adapters → archive subdir | Manual |
| Audit log | Capability Broker writes | Postgres | None | Steward analyzers; ledger view | Never | Bounded-growth check (Steward #8) |
| Backups | Vault + DB hourly | Filesystem (off-server) | Compressed | Restore drill | 30d retention | Auto-purged |

## Retention defaults

- **Permanent**: memory MD, ADRs, AKG entities, audit log (subject to bounded-growth check via Steward failure mode #8).
- **Time-bounded**: Vault snapshots (30 days), DB backups (rolling), telemetry (per Lantern config), training corpus (90 days), model adapters (until replaced).
- **Versioned-but-permanent**: Vault KV v2 (old versions kept for audit).

## Vector embedding versioning

- **Re-embed on source change**: yes (sqlite-vec content-hash trigger).
- **Re-embed on model upgrade**: no, by default. Manual override at Curator's discretion when a quality-lift case justifies the cost.

## Backup pipeline

- **Vault snapshot**: daily to `/home/s903/backups/vault/`; 30d retention; off-server rsync to Mac at `~/Library/Application Support/Stolution/vault-snapshots/` (LaunchAgent `com.stolution.vault-snapshot-pull`).
- **DB backup**: hourly via `apps/db-backup/`.
- **Restore drill**: quarterly via `~/stolution/scripts/backup/test-vault-restore.sh`.
- Steward failure mode #7 surfaces stale or empty backups.

## Re-evaluation triggers

1. **Productisation** — adds Regulated class; extends classification matrix per applicable regulations (GDPR, CCPA, SOC 2).
2. **Compliance audit** — first audit may require formalising data lineage + ROPAs.
3. **Backup-drill failure** — quarterly drill failure triggers full backup-pipeline re-evaluation.

## See also

- [`data-ownership.md`](data-ownership.md) — who reads/writes what
- [`adr/ADR-014-hashicorp-vault.md`](adr/ADR-014-hashicorp-vault.md) — Secret-class canonical store
- [`adr/ADR-011-evidence-gate.md`](adr/ADR-011-evidence-gate.md) — gitleaks at PR merge
- `agent/memory/secrets_vault.md` — Vault operational details
- `agent/memory/feedback_pat_topic.md` — Sensitive (legacy) carve-out
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.2 — full audit
