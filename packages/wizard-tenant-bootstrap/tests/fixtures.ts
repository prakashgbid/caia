/**
 * Common fixtures for unit tests — sample tenant schema names, SQL
 * snippets, and helpers for writing temp SQL files when a test wants
 * the runner to read its own input.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { MigrationEntry } from '../src/types.js';

export const VALID_SCHEMA = 'tenant_prakash_stolution_com_abc12345';
export const ANOTHER_VALID_SCHEMA = 'tenant_alice_example_com_def67890';

export const SAMPLE_PER_TENANT_SQL = `
CREATE SCHEMA IF NOT EXISTS {{SCHEMA}};
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.sample_table (
  id UUID PRIMARY KEY,
  data JSONB
);
CREATE INDEX IF NOT EXISTS sample_table_idx ON {{SCHEMA}}.sample_table (id);
`.trim();

export const SAMPLE_QUOTED_PER_TENANT_SQL = `
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}".quoted_sample (
  id UUID PRIMARY KEY
);
`.trim();

/** Make a temp dir containing the given SQL file. Returns the file path. */
export async function writeTempSql(filename: string, sql: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wtb-test-'));
  const path = join(dir, filename);
  await writeFile(path, sql, 'utf8');
  return path;
}

/** Build a one-entry manifest pointing at a temp SQL file. */
export async function makeOneEntryManifest(
  packageName: string,
  filename: string,
  sql: string,
): Promise<MigrationEntry[]> {
  const sqlPath = await writeTempSql(filename, sql);
  return [{ packageName, filename, sqlPath }];
}
