#!/usr/bin/env node
/**
 * scripts/generate-changelog.mjs
 *
 * Runs at `prebuild` and `predev`. Pulls the last 30 squash-merge commits
 * from `origin/develop` and emits them as JSON to `lib/changelog.data.json`.
 *
 * Only commits whose subject contains a PR-number pattern (`(#NNN)`) are
 * kept — that filters out fixup/back-merge/branch-creation noise and gives
 * us the actual PR stream. The site renders this JSON statically at build
 * time so the page is fully cacheable.
 *
 * Robust to missing git history (sparse / shallow clones, freshly-cloned
 * preview environments). When git is unavailable, emits an empty entry list
 * so the page still renders.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'lib', 'changelog.data.json');
const LIMIT = 30;

function trySafe(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function collectEntries() {
  // Strict format: <sha>\x1f<iso-date>\x1f<subject>
  // Group separator \x1e between commits — safe vs commit subjects containing newlines.
  const FMT = '%H%x1f%aI%x1f%s%x1e';
  const out =
    trySafe(`git log origin/develop -n ${LIMIT * 3} --pretty=format:"${FMT}"`) ||
    trySafe(`git log -n ${LIMIT * 3} --pretty=format:"${FMT}"`);

  if (!out) return [];

  const raw = out.split('\x1e').map((l) => l.trim()).filter(Boolean);
  const entries = [];
  for (const line of raw) {
    const [sha, date, subject] = line.split('\x1f');
    if (!sha || !date || !subject) continue;
    // Only keep entries that look like a PR squash-merge
    const prMatch = subject.match(/\(#(\d+)\)/);
    if (!prMatch) continue;
    entries.push({
      sha: sha.slice(0, 8),
      date: date.split('T')[0],
      subject: subject.replace(/\s*\[True-Zero admin-merge\]\s*$/, ''),
      pr: Number(prMatch[1]),
    });
    if (entries.length >= LIMIT) break;
  }
  return entries;
}

function main() {
  const entries = collectEntries();
  const payload = {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    entries,
  };
  const dir = dirname(OUTPUT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`generate-changelog: wrote ${entries.length} entries → ${OUTPUT_PATH}`);
}

main();
