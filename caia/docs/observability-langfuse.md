# Observability — Langfuse self-hosted runbook

This is the operator runbook for the Langfuse stack defined in
`caia/observability/docker-compose.langfuse.yml`. It documents
how to run, debug, back up, and upgrade the trace store.

For the *why* behind the choice, see §6.7 of
`reports/caia-ai-tech-modernization-proposal-2026-04-30.md`.

## At a glance

- **Stack name:** `caia-observability` (docker compose project).
- **UI:** http://localhost:3001 (bound to 127.0.0.1 only).
- **Ingest endpoints:**
  - Langfuse SDK envelope: `POST /api/public/ingestion`
  - OTel OTLP HTTP traces: `POST /api/public/otel/v1/traces`
- **Metadata storage:** Postgres 15 (named volume `caia-langfuse-postgres-data`).
- **Trace event storage:** ClickHouse 24.3 (named volume `caia-langfuse-clickhouse-data`).
- **Queue:** Redis 7 (named volume `caia-langfuse-redis-data`).
- **Blob storage:** MinIO (named volume `caia-langfuse-minio-data`).
- **Telemetry to Langfuse cloud:** disabled (`TELEMETRY_ENABLED=false`).

## First-time bring-up

```bash
cd caia/observability

# Provisions .env.local from Vault if available, else generates and
# prints a vault-write incantation. Idempotent.
./init-langfuse-secrets.sh

# Starts all six containers in the right order. The first run takes
# ~60s for postgres + clickhouse migrations.
docker compose --env-file .env.local -f docker-compose.langfuse.yml up -d

# Wait for healthchecks to settle (≤90s).
docker compose --env-file .env.local -f docker-compose.langfuse.yml ps

# Synthetic-trace round-trip.
./smoke-test.sh

# Open the UI.
open http://localhost:3001
```

Log in with the email + password from `.env.local`
(fields `LANGFUSE_INIT_USER_EMAIL` + `LANGFUSE_INIT_USER_PASSWORD`).

## Where the secrets live

The canonical store is the Vault running on stolution at path
`secret/caia/langfuse`. Required fields:

| Vault field                  | Used as                                   |
|------------------------------|-------------------------------------------|
| `postgres_password`          | `LANGFUSE_POSTGRES_PASSWORD`              |
| `clickhouse_password`        | `LANGFUSE_CLICKHOUSE_PASSWORD`            |
| `redis_password`             | `LANGFUSE_REDIS_PASSWORD`                 |
| `minio_root_password`        | `LANGFUSE_MINIO_ROOT_PASSWORD`            |
| `encryption_key`             | `LANGFUSE_ENCRYPTION_KEY` (64 hex chars)  |
| `salt`                       | `LANGFUSE_SALT`                           |
| `nextauth_secret`            | `LANGFUSE_NEXTAUTH_SECRET`                |
| `admin_email`                | `LANGFUSE_INIT_USER_EMAIL`                |
| `admin_password`             | `LANGFUSE_INIT_USER_PASSWORD`             |
| `init_project_public_key`    | `LANGFUSE_INIT_PROJECT_PUBLIC_KEY` *      |
| `init_project_secret_key`    | `LANGFUSE_INIT_PROJECT_SECRET_KEY` *      |

* Optional. Determines the API keys CAIA's clients use to push traces.
  If omitted, Langfuse generates random keys and you read them out of
  the UI under **Settings → API keys** after first login.

To provision secrets initially:

```bash
ssh stolution "docker exec -i stolution-vault \
  vault kv put secret/caia/langfuse \
    postgres_password=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24) \
    clickhouse_password=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24) \
    redis_password=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24) \
    minio_root_password=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24) \
    encryption_key=$(openssl rand -hex 32) \
    salt=$(openssl rand -base64 32) \
    nextauth_secret=$(openssl rand -base64 32) \
    admin_email=ops@caia.local \
    admin_password=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
```

## Pointing CAIA at Langfuse

Once the stack is up and you have a public + secret API key from
**Settings → API keys**, set on whatever process emits traces:

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
export LANGFUSE_HOST=http://localhost:3001
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3001/api/public/otel/v1/traces
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $(echo -n "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" | base64)"
```

The orchestrator's launchd plist + the dashboard's environment file
should both pick these up. See PR #obs-002 (router OTel) and #obs-003
(agents OTel) for where these env vars are consumed.

## Health checks

```bash
# All containers Up + healthy?
docker compose --env-file .env.local -f docker-compose.langfuse.yml ps

# Web/API:
curl -fsS http://localhost:3001/api/public/health

# ClickHouse:
docker exec caia-langfuse-clickhouse clickhouse-client --query "SELECT 1"

# Postgres:
docker exec caia-langfuse-postgres pg_isready -U langfuse

# Redis:
docker exec caia-langfuse-redis redis-cli -a "$LANGFUSE_REDIS_PASSWORD" ping

# Synthetic round-trip:
./smoke-test.sh
```

## Backups

There are three things to back up:

1. **Postgres** (metadata + prompts + datasets) — small, daily
   pg_dump is plenty:

   ```bash
   docker exec caia-langfuse-postgres pg_dump -U langfuse langfuse \
     | gzip > ~/.caia/backups/langfuse-pg-$(date -u +%Y%m%d).sql.gz
   ```

2. **ClickHouse** (trace events) — the volume itself is the backup
   target. Either snapshot the named volume or use ClickHouse's
   `BACKUP TABLE` builtin into MinIO:

   ```bash
   docker exec caia-langfuse-clickhouse clickhouse-client \
     --query "BACKUP TABLE traces TO Disk('backups', 'traces-$(date -u +%Y%m%d)')"
   ```

3. **MinIO** (raw event payloads + uploaded media) — keep
   90+ days. Use the `mc mirror` command from the host:

   ```bash
   docker run --rm -v ~/.caia/backups:/backup minio/mc mirror \
     local/langfuse-events /backup/langfuse-events-$(date -u +%Y%m%d)
   ```

The cron in PR #obs-006 (DSPy trace export) also acts as a soft
backup: every day's traces are exported to
`~/.caia/traces/<date>.jsonl` for offline DSPy training, which means
even without the formal Postgres dump, the *useful* trace data is
preserved.

## Upgrades

Langfuse releases tagged Docker images on the `langfuse/langfuse:N`
schema (currently `:3` in the compose file). To bump:

```bash
# 1. Pin the new image tag in docker-compose.langfuse.yml.
# 2. Pull + recreate.
docker compose --env-file .env.local -f docker-compose.langfuse.yml pull
docker compose --env-file .env.local -f docker-compose.langfuse.yml up -d --remove-orphans

# 3. Watch the worker drain any pending migrations.
docker logs -f caia-langfuse-worker

# 4. Smoke-test.
./smoke-test.sh
```

If a major-version migration adds breaking schema changes, the worker
will refuse to start without `CLICKHOUSE_MIGRATION_URL` set; that's
already wired up in the compose file.

## Common failure modes

### `caia-langfuse-web` is unhealthy / crash-looping

Most often this is a missing or wrong secret in `.env.local`.
`docker logs caia-langfuse-web` will name the missing field. Re-run
`./init-langfuse-secrets.sh --force` to regenerate, then `docker
compose ... up -d --force-recreate langfuse-web`.

### Smoke test passes health but the trace doesn't appear

The worker drains async; allow ≤30s. If still missing, check
`docker logs caia-langfuse-worker` for ingestion errors. Common
cause: the `LANGFUSE_INIT_PROJECT_PUBLIC_KEY/SECRET_KEY` in the
SDK ENV doesn't match the ones actually provisioned in Postgres.
Look up the live keys under **Settings → API keys** in the UI.

### Disk pressure (ClickHouse keeps growing)

Default retention is unlimited. Set a TTL on the trace table:

```bash
docker exec caia-langfuse-clickhouse clickhouse-client --query "
  ALTER TABLE traces MODIFY TTL toDateTime(timestamp) + INTERVAL 30 DAY
"
```

§6.7 of the proposal sizes 30-day retention at ~50 GB / 5M spans/day.

### Orchestrator doesn't show traces

Check the env vars in `apps/orchestrator/plist/com.caia.orchestrator.plist`:

- `OTEL_EXPORTER_OTLP_ENDPOINT` should be
  `http://localhost:3001/api/public/otel/v1/traces`.
- `OTEL_EXPORTER_OTLP_HEADERS` should contain a Basic-auth header
  with the public:secret key pair.

After a plist edit, restart the daemon with `launchctl kickstart
-k gui/$(id -u)/com.caia.orchestrator`. (Do **NOT** kickstart the
daemon mid-validation campaign.)

## Tear-down

```bash
cd caia/observability
docker compose --env-file .env.local -f docker-compose.langfuse.yml down
# Persistent state remains in named volumes. To also drop data:
docker compose --env-file .env.local -f docker-compose.langfuse.yml down -v
```

`down -v` is destructive. Only do it on disposable environments
(local dev, CI). Production / Prakash's box should keep volumes.

## References

- §6.7 (Langfuse + OTel rationale)
- §7 (three-tier feedback loop blueprint)
- §8 P0.5 (this PR's place in the adoption sequence)
- `feedback_no_api_key_billing.md` (no SaaS / no API key constraint)
- Langfuse v3 docs: https://langfuse.com/self-hosting/docker-compose
- OTel `gen_ai.*` semantic conventions:
  https://opentelemetry.io/docs/specs/semconv/gen-ai/


## Foundation PR matrix (2026-05-01)

The seven PRs that brought up the obs foundation, in landing order:

| PR   | Branch                                | Adds                                                                                          |
|------|----------------------------------------|-----------------------------------------------------------------------------------------------|
| #261 | `feat/obs-001-langfuse-self-host`    | This document + the docker-compose stack on 127.0.0.1:3001                                    |
| #262 | `feat/obs-002-router-otel`           | OTel `gen_ai.*` spans on every `route()` call (12 vitest cases)                                |
| #264 | `feat/obs-003-agents-otel`           | `wrapAgent` / `wrapPipelineStage` / `recordJudgeScore` helpers (18 jest cases)                 |
| #265 | `feat/obs-004-trace-verifier`        | `scripts/verify-traces.sh` deployment readiness check                                          |
| #266 | `feat/obs-005-dashboard-link`        | `/operations/observability` Next.js route                                                      |
| #267 | `feat/obs-006-trace-export`          | Daily JSONL trace export at `~/.caia/traces/<date>.jsonl` (8 vitest cases)                     |
| #268 | `chore/obs-007-runbook`              | This addendum + memory file `reports/observability_foundation_2026-04-30.md`                   |

## Trace anatomy (what every span looks like)

```
pipeline.<stage>                        ← pipeline-stage span (obs-003)
  span_attrs:
    pipeline.stage                      (e.g. "po_decomposed")
    pipeline.prompt_id
    pipeline.story_id
    pipeline.correlation_id
  └── agent.<name>                      ← agent span (obs-003)
        span_attrs:
          agent.name                    (e.g. "po-agent")
          agent.role                    (closed enum, e.g. "po-decomposer")
          agent.input_schema            (e.g. "POAgentInputV1")
          agent.output_schema
          agent.duration_ms
          agent.judge_score             (when applicable)
          agent.attempt
          agent.ok
          gen_ai.agent.name             (mirror of agent.name for Langfuse)
          gen_ai.agent.type             (mirror of agent.role)
        └── llm.route <task_type>       ← router span (obs-002)
              span_attrs:
                gen_ai.system           ("ollama" | "claude-binary" | "cache")
                                        NEVER "api-key"
                gen_ai.provider.name    ("ollama" | "subscription")
                gen_ai.operation.name   ("chat")
                gen_ai.request.model    + .max_tokens + .temperature
                gen_ai.response.model
                gen_ai.usage.input_tokens / output_tokens / total_tokens
                gen_ai.usage.prompt_tokens / completion_tokens (legacy aliases)
                caia.task_type
                caia.route_decision     ("local" | "claude" | "cache_hit")
                caia.cache_hit
                caia.fallback_from / caia.fallback_reason
                caia.router_version
              status: OK | ERROR (with recorded exception event)
```

## Daily routine

**On the developer's Mac, set once:**

```bash
launchctl setenv LANGFUSE_PUBLIC_KEY pk-lf-...
launchctl setenv LANGFUSE_SECRET_KEY sk-lf-...
launchctl setenv LANGFUSE_HOST       http://localhost:3001
```

**On every dashboard restart:** the `/operations/observability` route
will read those env vars and surface live Langfuse data.

**On every orchestrator restart (legitimate, not during a validation
campaign):** the `apps/orchestrator` plist is configured to invoke
the router's `initRouterOtel()` at boot, and every `runXxx` call
(once obs-003a/b/c follow-on wirings land) emits `agent.<name>`
spans nested under `pipeline.<stage>` spans nested under
`llm.route` spans.

**Daily 03:05 UTC:** the `com.caia.export-traces-for-dspy` launchd
job (PR #267) pulls the last 24h of traces from Langfuse and
writes JSONL at `~/.caia/traces/<YYYY-MM-DD>.jsonl`. To install:

```bash
cp scripts/plist/com.caia.export-traces-for-dspy.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.caia.export-traces-for-dspy.plist
```

## Verification (fail-loud)

Both must exit 0 for the foundation to be considered operational:

```bash
cd caia/observability && ./smoke-test.sh    # synthetic trace round-trip
scripts/verify-traces.sh                    # end-to-end attribute check
```

`verify-traces.sh` asserts that **no observation in any test trace
ever reports `gen_ai.system="api-key"`** — the no-API-key constraint
from `feedback_no_api_key_billing.md` is structurally enforceable
at the trace store now.

## How to add instrumentation to a new agent / package

See `reports/observability_foundation_2026-04-30.md` for the full
how-to. Quick version:

```ts
// apps/orchestrator/src/agents/foo-agent.ts
import { wrapAgent } from '../observability/agent-otel.js';

export async function runFooAgent(input: FooInput): Promise<FooOutput> {
  return wrapAgent(
    {
      name: 'foo-agent',
      role: 'foo-role',           // add to AgentRole closed enum first
      inputSchema: 'FooInputV1',
      outputSchema: 'FooOutputV1',
      promptId: input.promptId,
    },
    async (span) => {
      // ... existing body ...
      // Optional: recordJudgeScore(span, 0.87);
      return result;
    },
  );
}
```

The router calls inside `runFooAgent` will already emit `llm.route`
spans (PR #262); they automatically nest under the agent span.

## Open follow-ups (post-foundation)

| Track       | Description                                                                                     |
|-------------|-------------------------------------------------------------------------------------------------|
| obs-003a/b/c | Wire `wrapAgent` into each `runXxx` runner (PR #264 ships only the helper). Reviewable per-agent. |
| dspy-001    | DSPy compile job — consumes `~/.caia/traces/*.jsonl` and writes prompts-registry candidates. P0.6 in proposal. |
| smart-cicd  | The §6A.5 worked example. P1.9 in proposal.                                                     |
| stop-fetch  | `@chiefaia/decomposer/src/claude-decomposer.ts` legacy fetch-based path → migrate or drop. Already flagged in `feedback_no_api_key_billing.md`. |
