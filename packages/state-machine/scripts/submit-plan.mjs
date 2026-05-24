#!/usr/bin/env node
// One-shot script: submit the solution-lifecycle plan to the EA Architect
// Agent and print the structured outcome to stdout. Used by the
// state-machine-architect agent per operator directive "EA Agent review:
// submit plan via submitPlan before proceeding."

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EaArchitectAgent } from '../../ea-architect/dist/index.js';
import { createDefaultCritic } from '../../ea-architect/dist/critic.js';

const HOME = homedir();
const PLAN_PATH = join(
  HOME,
  'Documents',
  'projects',
  'research',
  'plan_state_machine_solution_lifecycle_2026.md',
);
const OUT_PATH = join(
  HOME,
  'Documents',
  'projects',
  'research',
  'plan_state_machine_solution_lifecycle_2026.ea-review.json',
);

const planMarkdown = readFileSync(PLAN_PATH, 'utf8');

const agent = new EaArchitectAgent({
  autoFileAdrs: false, // dry-run: don't auto-file ADRs for the internal review submission
  surfaceEscalations: false, // don't write to operator INBOX for this submission
  // Bump timeout to 8 minutes — Opus reviews of long architecture-change plans
  // routinely exceed the default 90s cap.
  critic: createDefaultCritic({ timeoutMs: 8 * 60 * 1000 }),
});

console.error('[submit-plan] submitting to EA Architect Agent...');
const startedAt = Date.now();
const outcome = await agent.submitPlan({
  planMarkdown,
  planType: 'architecture-change',
  callerAgentId: 'state-machine-architect',
  submittedBy: 'state-machine-architect',
  affectedComponents: [
    '@caia/state-machine',
    '@chiefaia/events',
    '@chiefaia/events-taxonomy-internal',
    '@caia/pipeline-conductor',
    '@caia/deploy-steward',
    'caia_meta.solution_lifecycle',
    'caia_meta.solution_history',
  ],
  submissionId: 'sm-solution-lifecycle-2026-05-24',
});
const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
console.error(`[submit-plan] EA Agent returned in ${elapsedSec}s.`);

writeFileSync(OUT_PATH, JSON.stringify(outcome, null, 2), 'utf8');
console.error(`[submit-plan] wrote outcome JSON to ${OUT_PATH}`);

console.log(JSON.stringify(
  {
    status: outcome.status,
    iteration: outcome.iteration,
    modelTier: outcome.modelTier,
    submissionId: outcome.submissionId,
    cited_adrs: outcome.cited_adrs,
    cited_principles: outcome.cited_principles,
    cited_lessons: outcome.cited_lessons,
    requested_modifications: outcome.requested_modifications ?? [],
    new_adrs_count: (outcome.new_adrs_to_file ?? []).length,
    affected_existing_adrs: outcome.affected_existing_adrs ?? [],
    escalation: outcome.escalation_to_operator ?? null,
    reasoning: outcome.reasoning,
  },
  null,
  2,
));
