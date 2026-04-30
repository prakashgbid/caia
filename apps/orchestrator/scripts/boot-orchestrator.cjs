#!/usr/bin/env node
// Bootstrap for com.caia.orchestrator launchd job (replaces legacy ~/Documents/projects/conductor build).
// Exported function is the same name as legacy (startApiServer) — only the require path moves.
const { startApiServer } = require('../dist/src/api/start');

startApiServer()
  .then(() => {
    console.error('[boot] caia orchestrator API up on port', process.env.CONDUCTOR_HTTP_PORT || 7776);
  })
  .catch((e) => {
    console.error('[boot] FAIL', e && e.stack ? e.stack : e);
    process.exit(1);
  });
