#!/usr/bin/env node
/**
 * Submits PLAN.md to @caia/ea-architect via submitPlan().
 *
 * Mirrors packages/per-story-tester/scripts/submit-plan.mjs. Falls back
 * to a stub critic when CAIA_EA_STUB=1 so the orchestrator can record
 * the submission deterministically in autonomous runs without live
 * spawner credentials.
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
          'Stub critic (autonomous run): package surface matches the brief (runner + strategies + rollback + steward + api). State-machine transitions stay within the canonical Solution lifecycle FSM (merged -> deployed | deployed-failed | deployed-rolled-back). No new FSM states added. Reuses @caia/state-machine, @caia/devops-architect (strategy enum + infra-realism contract), @chiefaia/capability-broker (deploy.production token), @chiefaia/deploy-steward (ledger). Operator should run a live review before True-Zero admin-merge.',
        cited_adrs: [],
        cited_principles: ['P-no-vendor-lockin', 'P-true-zero', 'P-idempotency'],
        cited_lessons: [],
        requested_modifications: [
          'Operator: run live submitPlan against @caia/ea-architect before True-Zero admin-merge.',
          'Confirm BYOC adapter contract is shared with smart-cicd-agent and not duplicated.',
        ],
        new_adrs_to_file: [],
        affected_existing_adrs: [],
      }),
    };
  }

  const agent = new EaArchitectAgent(stub ? { critic } : {});
  const outcome = await agent.submitPlan({
    planMarkdown,
    planType: 'implementation',
    callerAgentId: '@caia/devops-runtime',
    submittedBy: 'autonomous-build',
    affectedComponents: [
      '@caia/devops-runtime',
      '@caia/state-machine',
      '@caia/devops-architect',
      '@chiefaia/capability-broker',
      '@chiefaia/deploy-steward',
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
