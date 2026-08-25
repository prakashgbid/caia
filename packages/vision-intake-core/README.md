# vision-intake-core

Shared types + outbox helper for the CAIA Vision Intake pipeline.

## Contents

- Pydantic models mirroring the Postgres DDL (see `infra/migrations/vision-intake/0001_initial_schema.sql`)
- Outbox pattern helper (`OutboxWriter`) used by both `vision-intake-api` and `vision-intake-orchestrator` to ensure exactly-once event publication to Kafka
- Event-schema JSON registry for the 4 Kafka topics:
  - `vision-intake.session.events`
  - `vision-intake.brief.events`
  - `vision-intake.dossier.events`
  - `vision-intake.review.events`

## Status

Epic 1 (Foundation) — README + placeholder module. Real code lands in E1-2 story (CAIA-371).
