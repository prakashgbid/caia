#!/usr/bin/env node
/**
 * Scope resolver — maps changed source files to behavior test files.
 *
 * Usage:
 *   npx tsx scope-tests.ts --files "src/app/page.tsx,src/engine/poker.ts"
 *   git diff --name-only HEAD | npx tsx scope-tests.ts --stdin
 *
 * Outputs a newline-separated list of test file paths relative to the site root.
 * Used by gate-publish.sh to run only the tests that cover changed code.
 */

import * as fs from 'fs';
import * as path from 'path';

const MAPPINGS: Array<{ pattern: RegExp; tests: string[] }> = [
  { pattern: /src\/app\/(page|layout)\.(tsx?|jsx?)|src\/components\/home\//,  tests: ['home.behavior.ts'] },
  { pattern: /src\/engine\/|src\/app\/play\//,                                tests: ['play.behavior.ts'] },
  { pattern: /src\/content\/|src\/app\/publications\//,                       tests: ['publications.behavior.ts'] },
  { pattern: /src\/components\/(layout|shell)\//,                             tests: ['layout-contract.behavior.ts', 'home.behavior.ts'] },
  { pattern: /src\/components\//,                                             tests: ['layout-contract.behavior.ts'] },
  // Global configs affect everything
  { pattern: /tailwind\.config|globals\.css|site\.(ts|js)/,                  tests: ['home.behavior.ts', 'layout-contract.behavior.ts'] },
];

function resolveTests(changedFiles: string[], behaviorDir: string): string[] {
  const testFiles = new Set<string>();

  for (const file of changedFiles) {
    let matched = false;
    for (const { pattern, tests } of MAPPINGS) {
      if (pattern.test(file)) {
        for (const t of tests) {
          const full = path.join(behaviorDir, t);
          if (fs.existsSync(full)) testFiles.add(full);
        }
        matched = true;
      }
    }
    // Unknown change in src/ → run layout contract as minimum
    if (!matched && /^src\//.test(file)) {
      const fallback = path.join(behaviorDir, 'layout-contract.behavior.ts');
      if (fs.existsSync(fallback)) testFiles.add(fallback);
    }
  }

  if (testFiles.size === 0) {
    // No src changes or nothing matched → run all
    if (fs.existsSync(behaviorDir)) {
      for (const f of fs.readdirSync(behaviorDir)) {
        if (f.endsWith('.behavior.ts')) testFiles.add(path.join(behaviorDir, f));
      }
    }
  }

  return [...testFiles];
}

async function main() {
  const args = process.argv.slice(2);
  const stdinMode = args.includes('--stdin');
  const filesIdx  = args.indexOf('--files');
  const cwd       = process.env['SITE_ROOT'] ?? process.cwd();
  const behaviorDir = path.join(cwd, 'tests', 'behavior');

  let changedFiles: string[] = [];

  if (stdinMode) {
    const input = await new Promise<string>((resolve) => {
      let data = '';
      process.stdin.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      process.stdin.on('end', () => resolve(data));
    });
    changedFiles = input.trim().split('\n').filter(Boolean);
  } else if (filesIdx >= 0 && args[filesIdx + 1]) {
    changedFiles = args[filesIdx + 1].split(',').map(f => f.trim()).filter(Boolean);
  } else {
    // No files specified — run all
    changedFiles = [];
  }

  const testFiles = resolveTests(changedFiles, behaviorDir);
  process.stdout.write(testFiles.join('\n') + (testFiles.length > 0 ? '\n' : ''));
}

main().catch(err => { console.error(err); process.exit(1); });
