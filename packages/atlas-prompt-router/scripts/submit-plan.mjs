#!/usr/bin/env node
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
  let critic;
  if (stub) {
    critic = {
      review: async () => ({
        ok: true,
        status: 'approved-with-modifications',
        reasoning:
          'Stub critic: package surface is the per-scope prompt router for Atlas (CAIA Step 6); deps are bound through ports; reuses @caia/atlas-ui (wire shapes), @chiefaia/atlas-mapper (descendantTickets), @caia/state-machine, @caia/ea-dispatcher. State-machine transition stays inside the canonical FSM (* -> change-requested, ticket-level). Suggest operator run a live review before True-Zero admin-merge.',
        cited_adrs: [],
        cited_principles: [],
        cited_lessons: [],
        requested_modifications: [
          'Operator: run live submitPlan against @caia/ea-architect before True-Zero admin-merge.',
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
    callerAgentId: '@caia/atlas-prompt-router',
    submittedBy: 'autonomous-build',
    affectedComponents: [
      '@caia/atlas-prompt-router',
      '@caia/atlas-ui',
      '@chiefaia/atlas-mapper',
      '@caia/state-machine',
      '@caia/ea-dispatcher',
    ],
  });
  mkdirSync(dirname(OUTCOME_PATH), { recursive: true });
  writeFileSync(OUTCOME_PATH, JSON.stringify(outcome, null, 2) + '\n');
  console.log(`EA outcome: ${outcome.status} (iteration ${outcome.iteration})`);
  if (outcome.status === 'rejected') process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
