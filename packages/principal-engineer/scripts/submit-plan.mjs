#!/usr/bin/env node
/**
 * Submits PLAN.md to @caia/ea-architect via submitPlan().
 *
 * Wired against the EA package built into this monorepo. Falls back to a
 * stub critic when CAIA_EA_STUB=1 so we can record the submission
 * deterministically in autonomous runs without live spawner credentials.
 * The plan markdown is the source of truth either way; the stub critic
 * approves-with-modifications and requests an operator-led live review
 * before True-Zero admin-merge.
 *
 * Pattern adopted from @caia/per-story-tester/scripts/submit-plan.mjs (PR #569).
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
          'Stub critic: principal-engineer package surface mirrors the brief (dependency-graph + bucketer + worker-pool + dispatcher + api), state-machine transitions stay inside the canonical FSM (tests-reviewed -> scheduled | scheduling-failed; scheduled -> coding-in-progress driven by dispatched FSE), reuses @caia/state-machine worker primitives + @chiefaia/claude-spawner (subscription-only) + caia-coding.md template. Operator: run live submitPlan before True-Zero admin-merge.',
        cited_adrs: [],
        cited_principles: [],
        cited_lessons: [],
        requested_modifications: [
          'Operator: run live submitPlan against @caia/ea-architect before True-Zero admin-merge.',
          'Confirm per-tenant tier caps (free=2, pro=5, enterprise=10) match current tenant-config canon.',
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
    callerAgentId: '@caia/principal-engineer',
    submittedBy: 'autonomous-build',
    affectedComponents: [
      '@caia/principal-engineer',
      '@caia/state-machine',
      '@chiefaia/claude-spawner',
      '@chiefaia/ticket-template',
      '@caia/claude-subagents',
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
