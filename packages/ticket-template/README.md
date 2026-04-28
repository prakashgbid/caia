# @chiefaia/ticket-template

The strict, Zod-validated **ticket template (v1)** for the CAIA Phase 1 agent
pipeline. It is the contract that every agent (PO, BA, EA, DBA, BFF, UI,
Security, Testing, Release, Observability) writes into and that the executor
reads out of.

## Why a strict template

Without a contract, every agent invents its own shape, and the executor cannot
trust the bundle handed to it. The template enforces:

1. **Required sections** every ticket must have (`scope`, `context`,
   `acceptanceCriteria`, `verificationPlan`, `dependencies`).
2. **Optional per-agent sections** that domain agents fill during BA enrichment
   (`agentSections.architecture`, `.database`, `.api`, `.ui`, `.security`,
   `.testing`, `.release`, `.observability`).
3. **Bounded counts** — at least 3 and at most 10 acceptance criteria so
   tickets stay actionable but specific.
4. **Audit fields** — every contributed section must record the agent that
   produced it and a timestamp.

## Usage

```ts
import {
  TicketTemplateV1Schema,
  validateTicket,
  TICKET_TEMPLATE_VERSION,
} from '@chiefaia/ticket-template';

const result = validateTicket(payload);
if (!result.ok) {
  // result.errors is a flat list of field-level Zod issues
  throw new Error(`ticket invalid: ${JSON.stringify(result.errors)}`);
}
// result.value is the parsed, typed TicketTemplateV1
```

## Versioning

Tickets carry `version: 'v1'`. Future breaking changes ship as `v2`, and
`templateVersion` on the `stories` row tells the validator which schema to
apply.
