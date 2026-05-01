# caia/observability

Self-hosted Langfuse stack for the CAIA observability foundation.

This is the **trace store** that ingests every `gen_ai.*` OTel span
the orchestrator + router + agents emit. It feeds the daily DSPy
compile, the smart CI/CD agent introspection cycle, and every
self-improvement loop in §7 of `caia-ai-tech-modernization-proposal-2026-04-30.md`.

## Quick start

```bash
cd caia/observability

# 1. Provision secrets (reads Vault if reachable; otherwise
#    generates fresh ones and prints a vault-write incantation).
./init-langfuse-secrets.sh

# 2. Bring the stack up.
docker compose --env-file .env.local -f docker-compose.langfuse.yml up -d

# 3. Smoke-test it.
./smoke-test.sh

# 4. Open the UI.
open http://localhost:3001
```

## What's running

| Container                  | Port              | Purpose                              |
|----------------------------|-------------------|--------------------------------------|
| `caia-langfuse-web`        | 127.0.0.1:3001    | UI + ingest API + read API           |
| `caia-langfuse-worker`     | (internal)        | queue drainer, eval runner           |
| `caia-langfuse-postgres`   | (internal)        | metadata (users, projects, prompts)  |
| `caia-langfuse-clickhouse` | (internal)        | trace + observation events           |
| `caia-langfuse-redis`      | (internal)        | ingest queue                         |
| `caia-langfuse-minio`      | (internal)        | S3-compat blob store                 |

All ports bound to 127.0.0.1 only. The `langfuse-internal` Docker
network handles inter-service comms.

## See also

- `caia/docs/observability-langfuse.md` — full operator runbook
  (backup, upgrade, rotate secrets, troubleshooting).
- `reports/caia-ai-tech-modernization-proposal-2026-04-30.md` §6.7,
  §7, §8 P0.5 — the rationale for picking Langfuse + OTel.
