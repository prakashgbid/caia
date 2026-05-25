/**
 * Smoke test for the per-tenant migration template. We don't run pg here;
 * we lint the SQL surface (CHECKs, NOTIFY trigger, schema substitution).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG_PATH = join(HERE, '..', 'migrations', '001_grand_ideas.sql');

describe('migrations/001_grand_ideas.sql', () => {
  it('has a {{SCHEMA}} placeholder', async () => {
    const sql = await readFile(MIG_PATH, 'utf8');
    expect(sql.includes('{{SCHEMA}}')).toBe(true);
  });

  it('declares grand_ideas with the expected columns', async () => {
    const sql = await readFile(MIG_PATH, 'utf8');
    for (const col of [
      'id',
      'tenant_slug',
      'project_id',
      'revision_number',
      'prompt',
      'prompt_word_count',
      'captured_by',
      'captured_at',
      'metadata',
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('enforces the word-count floor and ceiling as DB CHECK constraints', async () => {
    const sql = await readFile(MIG_PATH, 'utf8');
    expect(sql).toMatch(/CHECK\s*\(\s*prompt_word_count\s*>=\s*5\s*\)/);
    expect(sql).toMatch(/CHECK\s*\(\s*prompt_word_count\s*<=\s*5000\s*\)/);
  });

  it('installs a LISTEN/NOTIFY trigger on insert', async () => {
    const sql = await readFile(MIG_PATH, 'utf8');
    expect(sql).toMatch(/pg_notify\(\s*'grand_idea_captured'/);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+grand_idea_captured_notify/i);
  });

  it('uses IF NOT EXISTS guards so it can run idempotently', async () => {
    const sql = await readFile(MIG_PATH, 'utf8');
    const ifNotExists = sql.match(/IF NOT EXISTS/g)?.length ?? 0;
    expect(ifNotExists).toBeGreaterThanOrEqual(2);
  });
});
