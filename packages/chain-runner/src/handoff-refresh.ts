// Fire-and-forget hook to refresh SESSION_HANDOFF.md when a chain-runner event
// occurs that materially changes repo or chain state (PR merge, phase done).
//
// Rationale: SESSION_HANDOFF.md is the KT brief for new agents. A pure
// time-based cron (hourly) leaves a staleness window during which multiple
// merges/phase completions can land between refreshes. Firing event-triggered
// refreshes closes that gap.
//
// Constraints:
// - MUST NOT block the caller. The refresh script does network IO (gh api);
//   we detach it.
// - MUST NOT throw — if the helper is missing or fails, that's a soft failure;
//   the cron will still refresh on its next tick.
// - The triggered-by reason is forwarded to the script so the resulting banner
//   says exactly what fired the refresh (e.g. `pr-merged-prakashgbid/caia#434`,
//   `chain-phase-done-redflag-remediation-5`).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_REFRESH_SCRIPT = join(
  homedir(),
  '.caia',
  'handoff',
  'refresh_handoff.sh',
);

export interface FireHandoffRefreshOpts {
  triggeredBy: string;
  scriptPath?: string;
  enabled?: boolean; // default true; set false to no-op in tests
}

export function fireHandoffRefresh(opts: FireHandoffRefreshOpts): void {
  if (opts.enabled === false) return;
  if (process.env.CAIA_DISABLE_HANDOFF_REFRESH === '1') return;

  const script = opts.scriptPath ?? DEFAULT_REFRESH_SCRIPT;
  if (!existsSync(script)) {
    // Soft failure: cron remains the safety net.
    return;
  }

  const reason = (opts.triggeredBy || 'unspecified')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 120);

  try {
    const child = spawn('/bin/bash', [script, '--triggered-by', reason], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  } catch {
    // Never throw from the hook.
  }
}
