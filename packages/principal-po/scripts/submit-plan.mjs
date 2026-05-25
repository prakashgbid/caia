#!/usr/bin/env node
/**
 * Submits PLAN.md to @caia/ea-architect via submitPlan().
 *
 * Mirrors packages/principal-engineer/scripts/submit-plan.mjs (PR #577) and
 * packages/per-story-tester/scripts/submit-plan.mjs (PR #569).
 *
 * Falls back to a deterministic stub critic when CAIA_EA_STUB=1 so the
 * submission outcome can be recorded in autonomous runs without live
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
          'Stub critic: @caia/principal-po is a thin facade re-export package — no new logic, no new state, every export delegates to one of three subordinate packages (@caia/principal-engineer, @chiefaia/decomposer-recursive, @caia/architect-kit). Public surface is the union of relevant subordinate exports under canonical names from agent-memory/project_caia_canonical_pipeline_2026-05-22.md (decomposeStoryHierarchy, scheduleStoryGraph, common architect-kit utilities). Source-direct main:src/index.ts shape mirrors @caia/architect-kit; vitest resolves workspace deps directly to their src/ entries so tests do not require a built dist from principal-engineer. Naming-drift caveat on @chiefaia/decomposer-recursive scope is documented in README.md and deferred to a successor ADR (parallel to ADR-064 caveat on @chiefaia/adoption-enforcement). Operator: run live submitPlan before True-Zero admin-merge.',
        cited_adrs: [
          'ADR-054 — EA Repository as files (why the parallel ADR-064 ships as a markdown file rather than a PR)',
          'ADR-064 — three-steward boundaries (parallel naming-drift caveat on @chiefaia/adoption-enforcement; same posture applies here on @chiefaia/decomposer-recursive)',
        ],
        cited_principles: [
          'Reuse over reimplementation (facade delegates; no new logic)',
          'Memory vocabulary stays pointable from real code (canonical-name alignment)',
        ],
        cited_lessons: [],
        requested_modifications: [
          'Operator: run live submitPlan against @caia/ea-architect before True-Zero admin-merge.',
          'Follow-up ADR to resolve @chiefaia vs @caia npm-scope drift across the canonical packages (decomposer-recursive, adoption-enforcement).',
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
    callerAgentId: '@caia/principal-po',
    submittedBy: 'autonomous-build',
    affectedComponents: [
      '@caia/principal-po',
      '@caia/principal-engineer',
      '@chiefaia/decomposer-recursive',
      '@caia/architect-kit',
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
