#!/usr/bin/env node
/* eslint-disable */
/**
 * Boot stub for the launchd-managed orchestrator daemon.
 *
 * Invoked by ~/Library/LaunchAgents/com.caia.orchestrator.plist via
 *   node tsx/cli.mjs boot-orchestrator.cjs
 * which means we run inside tsx's loader context — `require()` here can
 * load TypeScript sources directly. We import startApiServer from
 * src/api/start.ts and invoke it.
 *
 * Recreated 2026-04-30 as part of the LAI-001 / PO-DECOMP daily release.
 * The original file was missing, leaving the launchd plist broken; the
 * orchestrator was only kept alive by a long-running tsx process from
 * before the deletion.
 */
'use strict';

const path = require('path');
const startTs = path.join(__dirname, '..', 'src', 'api', 'start.ts');

// tsx's loader hooks let us `require` a .ts file directly.
const { startApiServer } = require(startTs);

(async () => {
  try {
    const handle = await startApiServer();
    const shutdown = (sig) => {
      try { handle.stop(); } catch (_) {}
      process.exit(sig === 'SIGINT' ? 130 : 0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    // eslint-disable-next-line no-console
    console.error('[boot-orchestrator] startApiServer() resolved; pid=' + process.pid);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[boot-orchestrator] startApiServer failed:', err);
    process.exit(1);
  }
})();
