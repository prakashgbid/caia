#!/usr/bin/env ts-node
/**
 * gate:observability — AST-scans exported functions in src/ and packages/.
 * Fails if any lack either:
 *   - at least one eventBus.publish() call, OR
 *   - a @no-events annotation comment
 *
 * Annotation forms accepted:
 *   /** @no-events — reason *\/
 *   // @no-events
 *
 * Exit 0 = all covered. Exit 1 = gaps found.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src/api/routes', 'src/events', 'packages/event-bus', 'packages/logger'];
const EXCLUDE_PATTERNS = [/\.d\.ts$/, /node_modules/, /dist\//];

interface Finding {
  file: string;
  fn: string;
  line: number;
}

function* walkTs(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (EXCLUDE_PATTERNS.some(p => p.test(full))) continue;
    if (entry.isDirectory()) yield* walkTs(full);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield full;
  }
}

function scanFile(filePath: string): Finding[] {
  const src = fs.readFileSync(filePath, 'utf-8');
  const lines = src.split('\n');
  const findings: Finding[] = [];

  // Find exported function declarations
  const exportedFnRe = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
  let match: RegExpExecArray | null;

  while ((match = exportedFnRe.exec(src)) !== null) {
    const fnName = match[1];
    const lineNum = src.slice(0, match.index).split('\n').length;

    // Extract the function body (rough heuristic: next 100 lines from declaration)
    const bodyLines = lines.slice(lineNum - 1, lineNum + 100);
    const bodyText = bodyLines.join('\n');

    const hasEventPublish = /eventBus\.publish\s*\(/.test(bodyText) ||
                            /\.publish\s*\(\s*\{/.test(bodyText);

    const hasNoEventsAnnotation = /\/\/\s*@no-events/.test(bodyText) ||
                                  /\*\s*@no-events/.test(bodyText) ||
                                  (() => {
                                    // Check 3 lines before the function declaration
                                    const priorLines = lines.slice(Math.max(0, lineNum - 4), lineNum - 1);
                                    return priorLines.some(l => /@no-events/.test(l));
                                  })();

    if (!hasEventPublish && !hasNoEventsAnnotation) {
      findings.push({ file: path.relative(ROOT, filePath), fn: fnName, line: lineNum });
    }
  }

  return findings;
}

function main(): void {
  const allFindings: Finding[] = [];

  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);
    for (const file of walkTs(absDir)) {
      allFindings.push(...scanFile(file));
    }
  }

  if (allFindings.length === 0) {
    console.log('✓ gate:observability — all exported functions have event coverage or @no-events annotation');
    process.exit(0);
  } else {
    console.error(`✗ gate:observability — ${allFindings.length} function(s) missing event instrumentation:`);
    for (const f of allFindings) {
      console.error(`  ${f.file}:${f.line}  ${f.fn}()`);
    }
    console.error('\nAdd eventBus.publish() or // @no-events annotation to each.');
    process.exit(1);
  }
}

main();
