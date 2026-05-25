#!/usr/bin/env node
/**
 * Submits PLAN.md to @caia/ea-architect via submitPlan().
 *
 * Mirrors packages/devops-runtime/scripts/submit-plan.mjs and
 * packages/test-author/scripts/submit-plan.mjs. Falls back to a stub
 * critic when CAIA_EA_STUB=1 so the orchestrator can record the
 * submission deterministically in autonomous runs without live spawner
 * credentials.
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
          'Stub critic (autonomous run, 2026-05-25, ADR-024 ratification): @caia/info-architect package surface matches the brief — agent + persistence + system-prompt + api + types + migrations. FSM extension stays within the canonical pipeline FSM (interview-complete -> information-architecture-in-progress -> information-architecture-complete -> proposal-generated). Three new states (information-architecture-in-progress, information-architecture-complete, information-architecture-failed) and the IA-failure recovery edges (-> interview-complete, -> information-architecture-in-progress) are enumerated in transitions.ts. The pre-2026-05-25 direct edge interview-complete -> proposal-generated is removed; this is a behaviour change and the proposal-generator now runs from IA-complete via @caia/state-machine/whats-next. Reuses @caia/state-machine, @chiefaia/claude-spawner (subscription-only), and the per-tenant {{SCHEMA}} substitution pattern from @caia/grand-idea. Wave-1 deferrals (deep critic loop, S3 snapshots, ArchitectInput extension, Step 4 refactor, @caia/info-architect-playbook, @caia/info-architect-types) are documented in PLAN.md §2.2. Operator should run a live submitPlan against @caia/ea-architect before True-Zero admin-merge.',
        cited_adrs: ['ADR-024', 'ADR-061'],
        cited_principles: [
          'P-no-vendor-lockin',
          'P-true-zero',
          'P-idempotency',
          'P-subscription-only-llm',
        ],
        cited_lessons: [],
        requested_modifications: [
          'Operator: run live submitPlan against @caia/ea-architect before True-Zero admin-merge.',
          'Wave 2: extract @caia/info-architect-types as a standalone Zod-schema package.',
          'Wave 2: wire the §9.13 critic-loop rubric and replace the skeleton fallback.',
          'Wave 2: extend ArchitectInput with the informationArchitecture field across all 17 architects.',
          'Wave 2: refactor @caia/business-proposal-generator to read IA artifacts.',
          'Wave 2: add S3 snapshot mirror per IA spec §8.',
        ],
        new_adrs_to_file: [],
        affected_existing_adrs: [
          'ADR-024 (this PR is the implementation of the ratified decision)',
        ],
      }),
    };
  }

  const agent = new EaArchitectAgent(stub ? { critic } : {});
  const outcome = await agent.submitPlan({
    planMarkdown,
    planType: 'implementation',
    callerAgentId: '@caia/info-architect',
    submittedBy: 'autonomous-build',
    affectedComponents: [
      '@caia/info-architect',
      '@caia/state-machine',
      '@chiefaia/claude-spawner',
      '@chiefaia/atlas-mapper',
      '@chiefaia/ticket-template',
      '@caia/business-proposal-generator',
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
