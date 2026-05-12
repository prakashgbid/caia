import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock } from './lock.js';
import { findPhase } from './spec.js';
import { markInProgress, type StateContext } from './state.js';

export interface DispatchOptions {
  command: string;
  args?: string[];
}

export interface DispatchResult {
  phaseId: number;
  sessionId: string;
  promptFile: string;
  pid: number | null;
}

function genSessionId(phaseId: number): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  return `phase${phaseId}-${ts}-${process.pid}`;
}

export function buildPromptFile(
  ctx: StateContext,
  phaseId: number,
  totalPhases: number,
): string {
  const phase = findPhase(ctx.spec, phaseId);
  const maxMinutes =
    phase.max_minutes ?? ctx.spec.defaults?.max_minutes ?? 45;
  const header = `# PHASE ${phaseId} OF ${totalPhases} — autonomous run

You are running phase ${phaseId} of the chain. The orchestrator dispatched you with all context.

Operate fully autonomously:
- DO NOT return for clarification. Make best informed decisions and document them.
- Stay within budget: max ${maxMinutes} minutes wall-clock.

Your task starts below:
---
`;
  const body = String(phase.prompt_template ?? '');
  const dir = mkdtempSync(join(tmpdir(), `caia_chain_phase_${phaseId}_`));
  const file = join(dir, `phase_${phaseId}.txt`);
  writeFileSync(file, header + body);
  return file;
}

/**
 * Mark in-progress, write the prompt file, acquire the lock,
 * and (optionally) spawn the configured command in the background.
 *
 * If `dispatch.command` is empty, returns the prompt file + session id
 * without spawning — useful for callers that want to manage the spawn.
 */
export function dispatchPhase(
  ctx: StateContext,
  phaseId: number,
  dispatch?: DispatchOptions,
): DispatchResult {
  const sessionId = genSessionId(phaseId);
  const promptFile = buildPromptFile(ctx, phaseId, ctx.spec.phases.length);

  markInProgress(ctx, String(phaseId), sessionId);
  acquireLock(ctx, phaseId, sessionId);

  let pid: number | null = null;
  if (dispatch?.command) {
    const args = [
      ...(dispatch.args ?? []),
      String(phaseId),
      sessionId,
      promptFile,
    ];
    const child = spawn(dispatch.command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    pid = child.pid ?? null;
  }
  return { phaseId, sessionId, promptFile, pid };
}
