#!/usr/bin/env node
/**
 * register-event-types.ts
 *
 * Idempotent script — ensures the four conductor.* event types are present
 * in both packages/events-taxonomy-internal/{registry.yaml,index.ts}. Safe
 * to re-run; only inserts missing entries.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAXONOMY_DIR = resolve(__dirname, '../../events-taxonomy-internal');
const REGISTRY_YAML = resolve(TAXONOMY_DIR, 'registry.yaml');
const INDEX_TS = resolve(TAXONOMY_DIR, 'index.ts');

const NEW_EVENT_TYPES = [
  { type: 'conductor.escalation.opened',  severity: 'warning', actor: '[pipeline-conductor]', payload: '[project_id, stage, reason, threshold_seconds, elapsed_seconds, last_event_id]' },
  { type: 'conductor.escalation.closed',  severity: 'info',    actor: '[pipeline-conductor]', payload: '[escalation_id, project_id, resolution]' },
  { type: 'conductor.forecast.updated',   severity: 'info',    actor: '[pipeline-conductor]', payload: '[project_id, stage, p50_completion_at, p90_completion_at, sample_size]' },
  { type: 'conductor.pipeline-bottleneck.detected', severity: 'warning', actor: '[pipeline-conductor]', payload: '[stage, active_count, stuck_count, median_dwell_seconds, recommended_action]' },
] as const;

function ensureYaml(): { added: number; alreadyPresent: number } {
  const original = readFileSync(REGISTRY_YAML, 'utf8');
  let updated = original;
  let added = 0;
  let already = 0;
  const appendBlock = NEW_EVENT_TYPES.map((e) => {
    if (updated.includes(`- type: ${e.type}`)) { already += 1; return null; }
    added += 1;
    return ['',
      `  # Pipeline Conductor (research/conductor_agent_spec_2026.md §4.3)`,
      `  - type: ${e.type}`,
      `    severity: ${e.severity}`,
      `    actor: ${e.actor}`,
      `    payload: ${e.payload}`,
    ].join('\n');
  }).filter((s): s is string => s !== null).join('\n');

  if (appendBlock) {
    updated = updated.replace(/\s*$/, '') + '\n' + appendBlock + '\n';
    writeFileSync(REGISTRY_YAML, updated, 'utf8');
  }
  return { added, alreadyPresent: already };
}

function ensureIndexTs(): { added: number; alreadyPresent: number } {
  const original = readFileSync(INDEX_TS, 'utf8');
  let updated = original;
  let added = 0;
  let already = 0;

  if (!updated.includes("'pipeline-conductor'")) {
    updated = updated.replace(
      /(\|\s*'feature-registry-writer'\s*)(;)/,
      "$1\n  | 'pipeline-conductor'$2",
    );
    added += 1;
  } else { already += 1; }

  const allInUnion = NEW_EVENT_TYPES.every((e) =>
    new RegExp(`\\|\\s*'${e.type.replace(/\./g, '\\.')}'`).test(updated),
  );
  if (!allInUnion) {
    const block = [
      "  // ─── Pipeline Conductor (research/conductor_agent_spec_2026.md §4.3) ──────",
      "  | 'conductor.escalation.opened'",
      "  | 'conductor.escalation.closed'",
      "  | 'conductor.forecast.updated'",
      "  | 'conductor.pipeline-bottleneck.detected'",
    ].join('\n');
    updated = updated.replace(
      /(\|\s*'artifact\.superseded'\s*);/,
      `$1\n${block};`,
    );
    added += 1;
  } else { already += 1; }

  if (!updated.includes("'conductor.escalation.opened':")) {
    const block = [
      "  // ─── Pipeline Conductor ───────────────────────────────────────────────────",
      "  'conductor.escalation.opened': 'warning',",
      "  'conductor.escalation.closed': 'info',",
      "  'conductor.forecast.updated': 'info',",
      "  'conductor.pipeline-bottleneck.detected': 'warning',",
    ].join('\n');
    updated = updated.replace(
      /('task\.fix_loop_escalated':\s*'error',)\s*\n(\};)/,
      `$1\n${block}\n$2`,
    );
    added += 1;
  } else { already += 1; }

  if (!updated.includes('ConductorEscalationOpenedPayload')) {
    updated += `\n\n// ─── Pipeline Conductor ──────────────────────────────────────────────────────\n\nexport interface ConductorEscalationOpenedPayload {\n  project_id: string;\n  stage: string;\n  reason: string;\n  threshold_seconds: number;\n  elapsed_seconds: number;\n  last_event_id?: string;\n}\n\nexport interface ConductorEscalationClosedPayload {\n  escalation_id: string;\n  project_id: string;\n  resolution: 'resumed' | 'completed' | 'abandoned' | 'escalated-to-operator';\n}\n\nexport interface ConductorForecastUpdatedPayload {\n  project_id: string;\n  stage: string;\n  p50_completion_at: string | null;\n  p90_completion_at: string | null;\n  sample_size: number;\n}\n\nexport interface ConductorPipelineBottleneckDetectedPayload {\n  stage: string;\n  active_count: number;\n  stuck_count: number;\n  median_dwell_seconds: number;\n  recommended_action: 'scale-workers' | 'review-prompt' | 'escalate-to-architect' | 'none';\n}\n`;
    added += 1;
  } else { already += 1; }

  if (added > 0) writeFileSync(INDEX_TS, updated, 'utf8');
  return { added, alreadyPresent: already };
}

const yamlResult = ensureYaml();
const tsResult = ensureIndexTs();
console.log(`registry.yaml: added=${yamlResult.added} present=${yamlResult.alreadyPresent}`);
console.log(`index.ts:      added=${tsResult.added} present=${tsResult.alreadyPresent}`);
console.log('done.');
