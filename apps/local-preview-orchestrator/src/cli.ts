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
 * Mentor integration (PR-γ): if a Mentor event-bus DB path is reachable
 * (`CAIA_EVENT_BUS_DB_PATH` env var defaults to a Mac path), the CLI
 * constructs a Mentor `Client` and threads `mentorEmit` through deploy
 * options so successful deploys emit `PRMerged` events. The Client is
 * created lazily and silently no-ops if the DB can't be opened —
 * preserves the producer-non-blocking invariant.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { runPollLoop } from './poll-loop.js';
import { startDashboard } from './status-dashboard.js';
import { deploySite } from './deploy.js';
import { SITES, getSiteConfig } from './sites-config.js';
import { buildStatus } from './status-dashboard.js';
import {
  Client as MentorClient,
  type EventType,
  type PayloadOf
} from '@chiefaia/mentor-event-bus';

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
  const mentor = tryOpenMentorClient();
  if (!mentor) return base;
  // Adapt Mentor's typed emit to deploy.ts's narrowly-typed callback.
  const mentorEmit = <T extends EventType>(type: T, payload: PayloadOf<T>): void => {
    mentor.emit(type, payload);
  };
  return { ...base, mentorEmit };
}

/**
 * Try to open a Mentor client for the configured DB path. Returns undefined
 * (and logs nothing more than a single warning) if the path is unset or
 * the open fails — emit-points must NEVER block deploys on Mentor's
 * reliability.
 */
function tryOpenMentorClient(): MentorClient | undefined {
  const dbPath = process.env['CAIA_EVENT_BUS_DB_PATH'] ?? DEFAULT_MENTOR_DB_PATH;
  // Setting CAIA_EVENT_BUS_DISABLED=1 turns mentor emit off entirely (tests + opt-out).
  if (process.env['CAIA_EVENT_BUS_DISABLED'] === '1') return undefined;
  try {
    return new MentorClient({
      dbPath,
      processName: 'local-preview-orchestrator'
    });
  } catch (e) {
    console.warn(`[local-preview] mentor client open failed (continuing without emit): ${String(e)}`);
    return undefined;
  }
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
