#!/usr/bin/env node
import { cliMain } from '../dist/claude-wrap.js';

cliMain().catch((err) => {
  process.stderr.write(`claude-wrap: unhandled error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
