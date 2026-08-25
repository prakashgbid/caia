# vision-intake-api

REST gateway for the CAIA Vision Intake pipeline — stage 1 of the CAIA factory. Founders arrive with a raw idea; by the end of Vision Intake they have a full 7-epic startup dossier ready for Jira breakdown by the downstream factory stages.

## Status

**Epic 1 (Foundation) — scaffolding in place.** All 18 REST routes stubbed with 200-OK responses. Real handlers land in E2–E5 (Sprint-5 backlog CAIA-370..401).

## Spec sources

- [Overall Spec](https://thivaan.atlassian.net/wiki/spaces/CAIA/pages/7208963)
- [Wizard 1a](https://thivaan.atlassian.net/wiki/spaces/CAIA/pages/6881373)
- [Refinement 1b](https://thivaan.atlassian.net/wiki/spaces/CAIA/pages/7274536)
- [Dossier 1c](https://thivaan.atlassian.net/wiki/spaces/CAIA/pages/7274557)
- [Review 1d](https://thivaan.atlassian.net/wiki/spaces/CAIA/pages/6979593)
- [Data model + APIs](https://thivaan.atlassian.net/wiki/spaces/CAIA/pages/7372811)
- [Sprint Breakdown](https://thivaan.atlassian.net/wiki/spaces/CAIA/pages/6914160)
- [Jira Initiative CAIA-364](https://thivaan.atlassian.net/browse/CAIA-364)

## Dev loop

```bash
cd apps/vision-intake-api
pip install -r requirements.txt
uvicorn app.main:app --reload --port 9170
curl http://127.0.0.1:9170/health
curl http://127.0.0.1:9170/docs
```

## Deploy

```bash
docker compose -f apps/vision-intake-api/docker-compose.yml up -d
```

Requires `infrastructure_stolution-network` external network + Vault AppRole tuple in env.

## Architecture

- **Per-tenant DB**: Postgres schema `vision_intake` with RLS (`app.current_tenant` session var pinned per request).
- **Event bus**: Outbox → Kafka pattern (4 topics — session, brief, dossier, review).
- **Secrets**: Vault AppRole on boot; no secrets in env beyond `ROLE_ID`/`SECRET_ID`.
- **Observability**: Prometheus `/metrics` (TODO), OTel traces, structured logs.

## Related

- `apps/vision-intake-orchestrator` — Temporal workflow host for refinement + dossier generation
- `packages/vision-intake-core` — shared types + outbox helper
- `infra/migrations/vision-intake/` — Postgres DDL
