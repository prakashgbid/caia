#!/usr/bin/env ts-node
/**
 * TypeScript build runner — programmatic wrapper around build steps.
 * Emits conductor events and persists build run to DB.
 *
 * Usage: ts-node scripts/build-runner.ts [--trigger user|pre-commit|ci|executor]
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as crypto from 'crypto';

const API = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';
const TRIGGER = (() => {
  const idx = process.argv.indexOf('--trigger');
  return idx !== -1 ? process.argv[idx + 1] : 'user';
})();

const BUILD_RUN_ID = `br_${crypto.randomBytes(6).toString('hex')}`;
const GIT_SHA = (() => {
  try { return execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim(); } catch { return 'unknown'; }
})();
const BRANCH = (() => {
  try { return execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' }).toString().trim(); } catch { return 'unknown'; }
})();

interface StepResult {
  name: string;
  exitCode: number;
  durationMs: number;
  stderrTail: string;
  errorSignature: string;
}

async function apiPost(url: string, body: unknown): Promise<void> {
  try {
    await fetch(`${API}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* API may not be running — non-fatal */ }
}

async function apiPatch(url: string, body: unknown): Promise<void> {
  try {
    await fetch(`${API}${url}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch { /* non-fatal */ }
}

async function runStep(name: string, command: string, order: number): Promise<StepResult> {
  const stepId = `${BUILD_RUN_ID}_s${order}`;
  const start = Date.now();
  const now = () => new Date().toISOString();

  await apiPost(`/builds/${BUILD_RUN_ID}/steps`, {
    id: stepId, build_run_id: BUILD_RUN_ID, step_name: name, command,
    step_order: order, status: 'running', started_at: now(),
  });
  await apiPost('/events', {
    type: 'build.step_started', actor: 'build-runner',
    payload: { build_run_id: BUILD_RUN_ID, build_step_id: stepId, step_name: name, command },
  });

  console.log(`▶ [${order}] ${name}`);
  const result = spawnSync('bash', ['-c', command], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  const exitCode = result.status ?? 1;
  const durationMs = Date.now() - start;
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const stderrTail = output.split('\n').slice(-10).join('\n');
  const errorSignature = output.match(/(error TS\d+|Error:|FAIL |FAILED)/g)?.slice(0, 3).join(', ') ?? '';
  const status = exitCode === 0 ? 'success' : 'failed';

  if (exitCode !== 0) process.stdout.write(output);

  await apiPatch(`/builds/${BUILD_RUN_ID}/steps/${stepId}`, {
    status, exit_code: exitCode, ended_at: now(), duration_ms: durationMs,
    stderr_tail: stderrTail, error_signature: errorSignature,
  });
  await apiPost('/events', {
    type: exitCode === 0 ? 'build.step_completed' : 'build.step_failed',
    actor: 'build-runner',
    payload: { build_run_id: BUILD_RUN_ID, build_step_id: stepId, step_name: name, exit_code: exitCode, duration_ms: durationMs, stderr_tail: stderrTail, error_signature: errorSignature },
  });

  console.log(`  ${exitCode === 0 ? '✓' : '✗'} ${name} (${durationMs}ms)`);
  return { name, exitCode, durationMs, stderrTail, errorSignature };
}

async function main(): Promise<void> {
  const startMs = Date.now();
  const now = () => new Date().toISOString();

  console.log(`=== Conductor build runner (TS) ===`);
  console.log(`  build_run_id: ${BUILD_RUN_ID}  trigger: ${TRIGGER}  sha: ${GIT_SHA}`);

  await apiPost('/builds', {
    id: BUILD_RUN_ID, trigger: TRIGGER, git_sha: GIT_SHA, branch: BRANCH,
    started_at: now(), status: 'running', steps_total: 0, steps_failed: 0,
  });
  await apiPost('/events', {
    type: 'build.started', actor: 'build-runner',
    payload: { build_run_id: BUILD_RUN_ID, trigger: TRIGGER, git_sha: GIT_SHA, branch: BRANCH, changed_files: [] },
  });

  const steps: Array<{ name: string; command: string }> = [
    { name: 'typecheck', command: 'npm run typecheck' },
    { name: 'test', command: 'npm test -- --passWithNoTests' },
    { name: 'build', command: 'npm run build' },
  ];

  // Add available gates
  const pkgJson = require('../package.json') as { scripts?: Record<string, string> };
  const gates = ['gate:observability', 'gate:coverage', 'gate:events-taxonomy'] as const;
  for (const gate of gates) {
    if (pkgJson.scripts?.[gate]) steps.push({ name: gate, command: `npm run ${gate}` });
  }

  const results: StepResult[] = [];
  let aborted = false;

  for (let i = 0; i < steps.length; i++) {
    const r = await runStep(steps[i].name, steps[i].command, i + 1);
    results.push(r);
    if (r.exitCode !== 0 && ['typecheck', 'build'].includes(r.name)) {
      aborted = true;
      break;
    }
  }

  const durationMs = Date.now() - startMs;
  const stepsFailed = results.filter(r => r.exitCode !== 0).length;
  const outcome = stepsFailed === 0 ? 'success' : 'failure';

  if (aborted) {
    await apiPatch(`/builds/${BUILD_RUN_ID}`, {
      status: 'failed', outcome: 'failure', ended_at: now(),
      duration_ms: durationMs, steps_total: results.length, steps_failed: stepsFailed,
    });
    await apiPost('/events', {
      type: 'build.aborted', actor: 'build-runner',
      payload: { build_run_id: BUILD_RUN_ID, reason: 'step_failed', completed_steps: results.length - 1 },
    });
    console.log(`\n✗ Build FAILED in ${durationMs}ms`);
    process.exit(1);
  } else {
    await apiPatch(`/builds/${BUILD_RUN_ID}`, {
      status: 'completed', outcome, ended_at: now(),
      duration_ms: durationMs, steps_total: results.length, steps_failed: stepsFailed,
    });
    await apiPost('/events', {
      type: 'build.completed', actor: 'build-runner',
      payload: { build_run_id: BUILD_RUN_ID, outcome, duration_ms: durationMs, steps_total: results.length, steps_failed: stepsFailed },
    });
    console.log(`\n${outcome === 'success' ? '✓' : '~'} Build ${outcome} in ${durationMs}ms`);
    process.exit(stepsFailed > 0 ? 1 : 0);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
