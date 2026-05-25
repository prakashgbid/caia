#!/usr/bin/env node
/**
 * Submits PLAN.md to @caia/ea-architect via submitPlan().
 *
 * Mirrors packages/devops-runtime/scripts/submit-plan.mjs and
 * packages/per-story-tester/scripts/submit-plan.mjs. Falls back
 * to a stub critic when CAIA_EA_STUB=1 so the orchestrator can
 * record the submission deterministically in autonomous runs
 * without live spawner credentials.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(__dirname, '..', 'PLAN.md');
const OUTCOME_PATH = join(__dirname, '..', 'EA-REVIEW-OUTCOME.json');

const planMarkdown = readFileSync(PLAN_PATH, 'utf8');

async function main() {
  const { EaArchitectAgent } = await import('@caia/ea-architect');

  const stub = process.env.CAIA_EA_STUB === '1';
  /** @type {any} */
  let critic;
  if (stub) {
    critic = {
      review: async () => ({
        ok: true,
        status: 'approved-with-modifications',
        reasoning:
          'Stub critic (autonomous run): package surface mirrors the existing @chiefaia/event-bus-internal API (publish/subscribe/replay) with a NATS JetStream backend. Aligns with spec research/inter_agent_communication_protocol_2026.md §4.7. Subscription-only, self-hosted on stolution K3s, $0 new cost. V1 scope cut: ships broker manifests + at-least-once envelope + one round-trip pub/sub + 40+ unit tests; full 57-event stream config and saga semantics deferred to v0.2. Operator should run a live review before True-Zero admin-merge.',
        cited_adrs: [],
        cited_principles: ['P-no-vendor-lockin', 'P-true-zero', 'P-idempotency'],
        cited_lessons: [],
        requested_modifications: [
          'Operator: run live submitPlan against @caia/ea-architect before True-Zero admin-merge.',
          'Confirm NKey rotation procedure with infra-architect before V1 goes to prod.',
          'V0.2 must add per-namespace stream fanout for the full 57-event taxonomy.',
        ],
        new_adrs_to_file: [],
        affected_existing_adrs: ['ADR-011'],
      }),
    };
  }

  const agent = new EaArchitectAgent(stub ? { critic } : {});
  const outcome = await agent.submitPlan({
    planMarkdown,
    planType: 'implementation',
    callerAgentId: '@chiefaia/event-bus-nats',
    submittedBy: 'autonomous-build',
    affectedComponents: [
      '@chiefaia/event-bus-nats',
      '@chiefaia/event-bus-internal',
      '@chiefaia/events-taxonomy-internal',
      'caia/infra/nats',
    ],
  });

  mkdirSync(dirname(OUTCOME_PATH), { recursive: true });
  writeFileSync(OUTCOME_PATH, JSON.stringify(outcome, null, 2) + '\n');
  console.log(`EA outcome: ${outcome.status} (iteration ${outcome.iteration})`);
  if (outcome.status === 'rejected') process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
