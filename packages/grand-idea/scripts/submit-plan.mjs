#!/usr/bin/env node
/**
 * Submit @caia/grand-idea EA-PLAN.md to the EA Architect Agent via
 * @caia/ea-architect's `submitPlan`, capturing the verdict to
 * EA_REVIEW.json so the operator can audit that the plan was reviewed.
 *
 * Loader fallback order: workspace → main-checkout dist → heuristic stub.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(__dirname);
const PLAN_PATH = join(PKG_ROOT, 'EA-PLAN.md');
const VERDICT_PATH = join(PKG_ROOT, 'EA_REVIEW.json');

const MAIN_CHECKOUT_DIST = join(
  homedir(),
  'Documents/projects/caia/packages/ea-architect/dist/index.js',
);

async function loadEaArchitect() {
  try {
    const mod = await import('@caia/ea-architect');
    return { mod, source: 'workspace' };
  } catch (workspaceErr) {
    try {
      const mod = await import(MAIN_CHECKOUT_DIST);
      return { mod, source: 'main-checkout' };
    } catch (mainErr) {
      throw new Error(
        `workspace: ${workspaceErr.message}; main-checkout: ${mainErr.message}`,
      );
    }
  }
}

async function main() {
  const planMarkdown = await readFile(PLAN_PATH, 'utf8');

  let load;
  try {
    load = await loadEaArchitect();
  } catch (err) {
    const fallback = fallbackVerdict(planMarkdown, err.message);
    await mkdir(dirname(VERDICT_PATH), { recursive: true });
    await writeFile(VERDICT_PATH, JSON.stringify(fallback, null, 2) + '\n');
    console.log(`[ea-submit] EA agent not loadable; wrote heuristic fallback`);
    console.log(`[ea-submit] reason: ${err.message}`);
    process.exit(0);
    return;
  }

  const { EaArchitectAgent } = load.mod;
  console.log(`[ea-submit] loaded EaArchitectAgent from ${load.source}`);

  const agent = new EaArchitectAgent({
    autoFileAdrs: false,
    surfaceEscalations: false,
  });

  const outcome = await agent.submitPlan({
    planMarkdown,
    planType: 'implementation',
    callerAgentId: 'cowork/stage-2-grand-idea-build',
    submittedBy: 'autonomous-build',
    affectedComponents: [
      '@caia/grand-idea',
      '@caia/onboarding',
      '@caia/state-machine',
      '@caia/interviewer',
    ],
    submissionId: 'grand-idea-stage-2-2026-05-25',
  });

  await mkdir(dirname(VERDICT_PATH), { recursive: true });
  await writeFile(
    VERDICT_PATH,
    JSON.stringify({ ...outcome, _source: load.source }, null, 2) + '\n',
  );

  console.log(`[ea-architect] status=${outcome.status}`);
  console.log(`[ea-architect] modelTier=${outcome.modelTier}`);
  console.log(`[ea-architect] iteration=${outcome.iteration}`);
  if (outcome.cited_adrs?.length) {
    console.log(`[ea-architect] cited_adrs=${outcome.cited_adrs.join(',')}`);
  }
  if (outcome.requested_modifications?.length) {
    console.log(`[ea-architect] requested_modifications:`);
    for (const m of outcome.requested_modifications) console.log(`  - ${m}`);
  }
  process.exit(outcome.status === 'rejected' ? 2 : 0);
}

function fallbackVerdict(planMarkdown, reason) {
  return {
    fallback: true,
    fallback_reason: reason,
    status: 'review_pending',
    reasoning:
      'EA Architect Agent could not be loaded; plan was NOT reviewed. '
      + 'Operator must review manually OR re-run from a fully-bootstrapped monorepo.',
    cited_adrs: [],
    cited_principles: [],
    cited_lessons: [],
    requested_modifications: [],
    submissionId: 'grand-idea-stage-2-2026-05-25',
    iteration: 0,
    reviewedAtIso: new Date().toISOString(),
    modelTier: 'none',
    plan_byte_count: Buffer.byteLength(planMarkdown, 'utf8'),
  };
}

main().catch((err) => {
  console.error(`[ea-submit] FATAL: ${err?.message ?? err}`);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
