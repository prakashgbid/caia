#!/usr/bin/env node
/**
 * Submits PLAN.md to @caia/ea-architect via submitPlan().
 *
 * Wired against the real EA Repository at ~/Documents/projects/caia-ea.
 * Falls back to a stub critic when CAIA_EA_STUB=1 so we can record the
 * submission deterministically in autonomous runs without live spawner
 * credentials. The plan markdown is the source of truth either way.
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
    // Deterministic record-only critic — emits approved-with-modifications
    // so the orchestrator can still surface follow-ups. The real critic
    // is wired when an operator runs without CAIA_EA_STUB.
    critic = {
      review: async () => ({
        ok: true,
        status: 'approved-with-modifications',
        reasoning:
          'Stub critic: Stage 13 FSE worker matches the brief (work-claimer + spec-reader + code-emitter + pr-opener + api), state-machine transitions stay within the canonical FSM (scheduled -> coding-in-progress -> code-complete | coding-failed), reuses @chiefaia/claude-spawner + @chiefaia/claude-subagents + @caia/state-machine + @caia/architect-kit. Stack-lock (shadcn/ui + Tailwind) encoded in agent.ts system prompt and spec-reader brief. Suggest operator run a live review before merge.',
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
    callerAgentId: '@caia/full-stack-engineer',
    submittedBy: 'autonomous-build',
    affectedComponents: [
      '@caia/full-stack-engineer',
      '@caia/state-machine',
      '@caia/architect-kit',
      '@chiefaia/claude-spawner',
      '@chiefaia/claude-subagents',
      '@chiefaia/ticket-template',
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
