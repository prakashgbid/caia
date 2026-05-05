#!/usr/bin/env node
/**
 * CLI / LaunchAgent entrypoint for the local-preview orchestrator.
 *
 * Subcommands:
 *   poll-loop                  — run the deploy daemon (one process for all sites)
 *   status-dashboard           — run the HTTP status dashboard
 *   deploy <site>              — one-shot deploy of a single site
 *   status                     — print one-line status JSON to stdout
 *
 * Wired into `package.json#bin.local-preview` → `dist/src/cli.js`. The PR-D
 * LaunchAgent plists invoke this binary with the appropriate subcommand.
 *
 * Mentor integration (PR-γ + PR-H):
 *   The orchestrator constructs a Mentor `Client` lazily via `LazyMentor`
 *   (see `mentor-emit.ts`). The lazy pattern fixes the leg-4 stage-6
 *   finding: the deploy daemon was bootstrapped BEFORE the
 *   mentor-event-bus install ran, so the eager open at startup failed and
 *   no PRMerged event ever fired even after Mentor was eventually
 *   installed. With LazyMentor, each successful deploy retries the open
 *   on demand; once Mentor is installed (whenever that happens), the next
 *   deploy picks it up automatically with no daemon restart.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { runPollLoop } from './poll-loop.js';
import { startDashboard } from './status-dashboard.js';
import { deploySite } from './deploy.js';
import { SITES, getSiteConfig } from './sites-config.js';
import { buildStatus } from './status-dashboard.js';
import { LazyMentor } from './mentor-emit.js';

const DEFAULT_INSTALL_ROOT = join(
  homedir(),
  'Library',
  'Application Support',
  'Stolution',
  'local-preview'
);
const DEFAULT_BUILD_WORKSPACE = '/private/tmp/local-preview-build';

const DEFAULT_MENTOR_DB_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'caia',
  'events',
  'events.sqlite'
);

const lazyMentor = new LazyMentor({ defaultDbPath: DEFAULT_MENTOR_DB_PATH });

function deployOptions(): {
  installRoot: string;
  buildWorkspaceRoot: string;
  mentorEmit?: (
    event: 'PRMerged',
    payload: { prNumber: number; sha: string; branch: string; repo?: string; previousSha?: string }
  ) => void;
} {
  const base = {
    installRoot: process.env['LOCAL_PREVIEW_INSTALL_ROOT'] ?? DEFAULT_INSTALL_ROOT,
    buildWorkspaceRoot: process.env['LOCAL_PREVIEW_BUILD_WORKSPACE'] ?? DEFAULT_BUILD_WORKSPACE
  };
  // The callback is invoked by deploy.ts only on success; we fetch the
  // lazy mentor at that time so a delayed Mentor install eventually wires
  // up without daemon restart. LazyMentor.emit returns a boolean for
  // observability but we ignore it — fire-and-forget by design.
  const mentorEmit = (
    type: 'PRMerged',
    payload: { prNumber: number; sha: string; branch: string; repo?: string; previousSha?: string }
  ): void => {
    lazyMentor.emit(type, payload);
  };
  return { ...base, mentorEmit };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case 'poll-loop': {
      const ctrl = new AbortController();
      process.on('SIGTERM', () => ctrl.abort());
      process.on('SIGINT', () => ctrl.abort());
      await runPollLoop({
        sites: SITES,
        deployOptions: deployOptions(),
        abortSignal: ctrl.signal
      });
      return;
    }

    case 'status-dashboard': {
      const port = Number.parseInt(process.env['LOCAL_PREVIEW_DASHBOARD_PORT'] ?? '5170', 10);
      const server = await startDashboard({
        installRoot: deployOptions().installRoot,
        port,
        deployOptions: deployOptions()
      });
      console.log(`[status-dashboard] listening on http://127.0.0.1:${port}`);
      const stop = (): void => {
        server.close(() => process.exit(0));
      };
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
      // Block forever
      await new Promise<void>(() => undefined);
      return;
    }

    case 'deploy': {
      const siteName = argv[1];
      if (!siteName) {
        console.error('usage: local-preview deploy <site>');
        process.exit(2);
      }
      const site = getSiteConfig(siteName);
      const result = await deploySite(site, deployOptions());
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.status === 'success' || result.status === 'noop' ? 0 : 1);
      return;
    }

    case 'status': {
      const status = buildStatus(deployOptions().installRoot, SITES);
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    default:
      console.error(
        'usage: local-preview {poll-loop|status-dashboard|deploy <site>|status}\n' +
          '  Defaults can be overridden via env:\n' +
          '    LOCAL_PREVIEW_INSTALL_ROOT      — per-site install root\n' +
          '    LOCAL_PREVIEW_BUILD_WORKSPACE   — ephemeral build worktrees\n' +
          '    LOCAL_PREVIEW_DASHBOARD_PORT    — status dashboard port (default 5170)\n' +
          '    CAIA_EVENT_BUS_DB_PATH          — mentor events.sqlite path\n' +
          '    CAIA_EVENT_BUS_DISABLED=1       — disable mentor emit'
      );
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error('[local-preview] fatal:', err);
  process.exit(1);
});
