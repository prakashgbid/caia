#!/usr/bin/env ts-node
/**
 * gate:events-taxonomy — verifies no unknown event types are published.
 * Scans all .ts files for eventBus.publish({type: 'foo'}) calls and checks
 * each against the canonical registry.
 *
 * Exit 0 = all types valid. Exit 1 = unknown types found.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ALL_EVENT_TYPES } from '../packages/events-taxonomy/index';

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'apps', 'packages'];
const VALID_TYPES = new Set<string>(ALL_EVENT_TYPES);

function* walkTs(dir: string): Generator<string> {
  if (!fs.existsSync(path.join(ROOT, dir))) return;
  const full = path.join(ROOT, dir);
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const fp = path.join(full, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isDirectory()) yield* walkDir(fp);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) yield fp;
  }
}

function* walkDir(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    if (entry.isDirectory()) yield* walkDir(fp);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) yield fp;
  }
}

interface TypeUsage { file: string; line: number; type: string }

function scanFile(filePath: string): TypeUsage[] {
  const src = fs.readFileSync(filePath, 'utf-8');
  const lines = src.split('\n');
  const usages: TypeUsage[] = [];

  // Match publish({type: 'foo'}) and type: 'foo' in event objects
  const re = /(?:type\s*:\s*['"`])([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)(?:['"`])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const type = m[1];
    // Only care about types that look like conductor event types (contain a dot)
    if (!type.includes('.')) continue;
    const lineNum = src.slice(0, m.index).split('\n').length;
    usages.push({ file: path.relative(ROOT, filePath), line: lineNum, type });
  }
  return usages;
}

function main(): void {
  const unknown: TypeUsage[] = [];

  for (const dir of SCAN_DIRS) {
    for (const file of walkTs(dir)) {
      for (const usage of scanFile(file)) {
        if (!VALID_TYPES.has(usage.type)) {
          unknown.push(usage);
        }
      }
    }
  }

  if (unknown.length === 0) {
    console.log('✓ gate:events-taxonomy — all event types are in the canonical registry');
    process.exit(0);
  } else {
    console.error(`✗ gate:events-taxonomy — ${unknown.length} unknown event type(s):`);
    for (const u of unknown) {
      console.error(`  ${u.file}:${u.line}  "${u.type}"`);
    }
    console.error('\nAdd missing types to packages/events-taxonomy/registry.yaml and index.ts');
    process.exit(1);
  }
}

main();
