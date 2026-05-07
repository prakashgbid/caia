#!/usr/bin/env node
/**
 * bootstrap-orchestrator-elevate.ts
 * Wrapper that invokes the bash bootstrap script.
 * This is the compiled entry point for npm bin.
 */

import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the bash script (relative to dist/bin)
const bashScript = join(__dirname, '../../bin/bootstrap-orchestrator-elevate.sh');

try {
  execSync(`bash "${bashScript}"`, {
    stdio: 'inherit',
    shell: true,
  });
} catch (error) {
  console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
