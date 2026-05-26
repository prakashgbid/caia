/**
 * Changelog data loader. Reads the JSON emitted by
 * `scripts/generate-changelog.mjs` at prebuild + predev. If the file is
 * missing (e.g. the script hasn't run yet in a unit-test environment),
 * returns an empty payload so the page still renders.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ChangelogEntry {
  sha: string;
  date: string;
  subject: string;
  pr: number;
}

export interface ChangelogPayload {
  generatedAt: string;
  count: number;
  entries: ChangelogEntry[];
}

const DATA_PATH = path.resolve(
  process.cwd(),
  'lib',
  'changelog.data.json'
);

export function loadChangelog(): ChangelogPayload {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    return JSON.parse(raw) as ChangelogPayload;
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      count: 0,
      entries: [],
    };
  }
}
