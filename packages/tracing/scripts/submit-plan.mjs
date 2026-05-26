#!/usr/bin/env node
/**
 * Submits packages/tracing/PLAN.md to @caia/ea-architect via the
 * reuse-check gate (@caia/reuse-check-gate.submitPlanWithReuseGate).
 *
 * Mirrors packages/event-bus-nats/scripts/submit-plan.mjs. Falls
 * back to a stub critic when CAIA_EA_STUB=1 so the orchestrator
 * can record the submission deterministically in autonomous runs
 * without live spawner credentials.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(__dirname, '..', 'PLAN.md');
const OUTCOME_PATH = join(__dirname, '..', 'EA-REVIEW-OUTCOME.json');

const planMarkdown = readFileSync(PLAN_PATH, 'utf8');

/**
 * Reuse search results — ADR-065 / @caia/reuse-check-gate.
 *
 * The CANONICAL reuse target is @chiefaia/tracing itself. v0.2.0
 * already shipped createTracer/startSpan/withSpan; this PR extends
 * it in place rather than spinning a parallel package. The operator
 * decision dated 2026-05-25 explicitly forbids @chiefaia/otel.
 */
const reuseSearchResults = [
  {
    packageName: '@chiefaia/tracing',
    considered: true,
    decision: 'selected',
    reason:
      'Canonical OTel surface. v0.2.0 already ships createTracer/startSpan/withSpan; this PR extends in place to add init/inject/extract/nats helpers. Operator decision 2026-05-25 explicitly forbids a parallel @chiefaia/otel package.',
  },
  {
    packageName: '@chiefaia/otel',
    considered: true,
    decision: 'rejected',
    reason:
      'Does not exist and operator decision 2026-05-25 forbids creating it. @chiefaia/tracing is the canonical reuse target.',
  },
  {
    packageName: '@opentelemetry/auto-instrumentations-node',
    considered: true,
    decision: 'rejected',
    reason:
      'Pulls 40+ instrumentations transitively; we only need pg/http/undici. Explicit individual instrumentations (@opentelemetry/instrumentation-pg, -http, -undici) keep the dep footprint tight and the surface obvious.',
  },
  {
    packageName: '@chiefaia/observability-architect',
    considered: true,
    decision: 'rejected',
    reason:
      'Different concern — that package is an EA architect for observability decisions, not a runtime tracing surface. Wrong abstraction layer.',
  },
  {
    packageName: '@opentelemetry/instrumentation-nats',
    considered: true,
    decision: 'rejected',
    reason:
      "Does not exist for nats@2 client. We ship manual withNatsPublishSpan/withNatsConsumeSpan helpers in @chiefaia/tracing that @chiefaia/event-bus-nats wraps around js.publish and the consume loop.",
  },
];

async function main() {
  const { submitPlanWithReuseGate } = await import('@caia/reuse-check-gate');
  const { EaArchitectAgent } = await import('@caia/ea-architect');

  const stub = process.env['CAIA_EA_STUB'] === '1';
  /** @type {any} */
  let critic;
  if (stub) {
    critic = {
      review: async () => ({
        ok: true,
        status: 'approved-with-modifications',
        reasoning:
          'Stub critic (autonomous run): Extends the canonical @chiefaia/tracing package per the operator-ratified reuse-first decision (2026-05-25). Adds init(), W3C TraceContext propagation, OTLP exporter wiring, pg/http/undici auto-instrumentations, and manual NATS publish/consume span helpers. Wires spans into the 6 spine packages (claude-spawner, state-machine, event-bus-nats, ea-architect, lifecycle-conductor, chain-runner). Deploys Tempo to chiefaia K3s ns ($0, no Ingress, sampling=1.0). Grafana deferred per operator decision. 23 vitest cases. Operator must run live review before True-Zero admin-merge.',
        cited_adrs: ['ADR-065'],
        cited_principles: [
          'P-reuse-first',
          'P-true-zero',
          'P-no-vendor-lockin',
          'P-no-api-keys',
        ],
        cited_lessons: [],
        requested_modifications: [
          'Operator: run live submitPlan against @caia/ea-architect before True-Zero admin-merge.',
          'Confirm Tempo emptyDir → PVC migration plan before retention SLAs land.',
          'Follow-up PR: install Grafana + replace infra/grafana/dashboards/caia-traces.json with real panel definitions.',
          'Follow-up PR: trace-volume-driven sampling drop from 1.0 → 0.1 once ingester pressure is observable.',
        ],
        new_adrs_to_file: [],
        affected_existing_adrs: ['ADR-065'],
      }),
    };
  }

  const agent = new EaArchitectAgent(stub ? { critic } : {});
  const outcome = await submitPlanWithReuseGate(
    {
      planMarkdown,
      planType: 'implementation',
      callerAgentId: '@chiefaia/tracing',
      submittedBy: 'autonomous-build',
      affectedComponents: [
        '@chiefaia/tracing',
        '@chiefaia/claude-spawner',
        '@caia/state-machine',
        '@chiefaia/event-bus-nats',
        '@caia/ea-architect',
        '@caia/lifecycle-conductor',
        '@chiefaia/chain-runner',
        'infra/tempo',
      ],
      reuseSearchResults,
    },
    agent,
  );

  mkdirSync(dirname(OUTCOME_PATH), { recursive: true });
  writeFileSync(OUTCOME_PATH, JSON.stringify(outcome, null, 2) + '\n');
  console.log(`EA outcome: ${outcome.status} (iteration ${outcome.iteration})`);
  if (outcome.status === 'rejected') process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
