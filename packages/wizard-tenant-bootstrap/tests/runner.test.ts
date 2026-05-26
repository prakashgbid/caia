import { describe, expect, it } from 'vitest';

import {
  applyMigration,
  applyManifest,
  substituteSchema,
} from '../src/runner.js';
import { TRACKER_TABLE_NAME, sqlChecksum } from '../src/tracker.js';
import {
  VALID_SCHEMA,
  SAMPLE_PER_TENANT_SQL,
  SAMPLE_QUOTED_PER_TENANT_SQL,
  makeOneEntryManifest,
  writeTempSql,
} from './fixtures.js';
import { makeMockPool, makeTrackerState } from './mock-pool.js';

describe('substituteSchema', () => {
  it('replaces every {{SCHEMA}} with the quoted identifier', () => {
    const out = substituteSchema(SAMPLE_PER_TENANT_SQL, VALID_SCHEMA);
    expect(out).not.toContain('{{SCHEMA}}');
    expect(out).toContain(`"${VALID_SCHEMA}"`);
  });

  it('collapses accidental `""tenant_…""` double-quote duplication', () => {
    // Some migrations (apps/dashboard/migrations/0010_wizard_state.sql)
    // wrap the placeholder in `"{{SCHEMA}}"`. After replace, the naive
    // result is `""tenant_…""` which is invalid SQL. The runner collapses.
    const out = substituteSchema(SAMPLE_QUOTED_PER_TENANT_SQL, VALID_SCHEMA);
    expect(out).not.toContain(`""${VALID_SCHEMA}""`);
    expect(out).toContain(`"${VALID_SCHEMA}".quoted_sample`);
  });

  it('returns identical output for identical inputs (deterministic)', () => {
    expect(substituteSchema(SAMPLE_PER_TENANT_SQL, VALID_SCHEMA)).toBe(
      substituteSchema(SAMPLE_PER_TENANT_SQL, VALID_SCHEMA),
    );
  });
});

describe('applyMigration', () => {
  function wireTrackerHandlers(pool: ReturnType<typeof makeMockPool>): ReturnType<typeof makeTrackerState> {
    const tracker = makeTrackerState();
    pool.on(/SELECT package, filename, checksum, applied_at/, (_t, params) => {
      const [pkg, file] = params as [string, string];
      const row = tracker.read(pkg, file);
      return row
        ? { rows: [{ package: pkg, filename: file, checksum: row.checksum, applied_at: '2026-05-26' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    });
    pool.on(/INSERT INTO "tenant_.*"._migrations_applied/, (_t, params) => {
      const [pkg, file, cs] = params as [string, string, string];
      tracker.write(pkg, file, cs);
      return { rows: [], rowCount: 1 };
    });
    return tracker;
  }

  it('reads the SQL file, substitutes {{SCHEMA}}, applies, records', async () => {
    const pool = makeMockPool();
    wireTrackerHandlers(pool);
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);
    const outcome = await applyMigration(pool, VALID_SCHEMA, entry!);
    expect(outcome.kind).toBe('applied');
    // Sequence: SELECT (tracker) → migration query → INSERT (record)
    const migrationCall = pool.calls.find((c) => c.text.includes('sample_table'));
    expect(migrationCall).toBeDefined();
    expect(migrationCall!.text).toContain(`"${VALID_SCHEMA}".sample_table`);
  });

  it('returns kind=skipped when the same checksum is already in the tracker', async () => {
    const pool = makeMockPool();
    const tracker = wireTrackerHandlers(pool);
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);
    const sub = substituteSchema(SAMPLE_PER_TENANT_SQL, VALID_SCHEMA);
    tracker.write('@caia/x', '0001_x.sql', sqlChecksum(sub));

    const outcome = await applyMigration(pool, VALID_SCHEMA, entry!);
    expect(outcome.kind).toBe('skipped');
    // The migration SQL itself must NOT have been executed.
    expect(pool.calls.find((c) => c.text.includes('sample_table'))).toBeUndefined();
  });

  it('returns kind=reapplied when the file checksum differs from the tracker', async () => {
    const pool = makeMockPool();
    const tracker = wireTrackerHandlers(pool);
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);
    tracker.write('@caia/x', '0001_x.sql', 'stale-checksum');

    const outcome = await applyMigration(pool, VALID_SCHEMA, entry!);
    expect(outcome.kind).toBe('reapplied');
    if (outcome.kind === 'reapplied') {
      expect(outcome.oldChecksum).toBe('stale-checksum');
      expect(outcome.newChecksum).not.toBe('stale-checksum');
    }
  });

  it('returns kind=failed with a read-error message when the file is missing', async () => {
    const pool = makeMockPool();
    wireTrackerHandlers(pool);
    const entry = {
      packageName: '@caia/x',
      filename: '0001_does_not_exist.sql',
      sqlPath: '/definitely/missing/path/0001_does_not_exist.sql',
    };
    const outcome = await applyMigration(pool, VALID_SCHEMA, entry);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.error).toMatch(/read/);
    }
  });

  it('returns kind=failed when pool.query throws on the migration', async () => {
    const pool = makeMockPool();
    wireTrackerHandlers(pool);
    pool.on(/sample_table/, () => {
      throw new Error('relation already exists with conflicting columns');
    });
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);
    const outcome = await applyMigration(pool, VALID_SCHEMA, entry!);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.error).toContain('apply:');
      expect(outcome.error).toContain('conflicting columns');
    }
  });

  it('refuses to apply against an invalid schema name', async () => {
    const pool = makeMockPool();
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);
    await expect(applyMigration(pool, 'caia_evil', entry!)).rejects.toThrow(/invalid tenant schema/);
  });
});

describe('applyManifest', () => {
  it('applies every entry in order and stops at the first failure', async () => {
    const pool = makeMockPool();
    const tracker = makeTrackerState();
    pool.on(/SELECT package, filename, checksum, applied_at/, (_t, params) => {
      const [pkg, file] = params as [string, string];
      const row = tracker.read(pkg, file);
      return row
        ? { rows: [{ package: pkg, filename: file, checksum: row.checksum, applied_at: '2026-05-26' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    });
    pool.on(/INSERT INTO "tenant_.*"._migrations_applied/, (_t, params) => {
      const [pkg, file, cs] = params as [string, string, string];
      tracker.write(pkg, file, cs);
      return { rows: [], rowCount: 1 };
    });
    pool.on(/SECOND_MIGRATION/, () => {
      throw new Error('boom');
    });

    const sqlA = await writeTempSql('a.sql', 'CREATE TABLE IF NOT EXISTS {{SCHEMA}}.first_t (id INT);');
    const sqlB = await writeTempSql('b.sql', 'SELECT 1 /*SECOND_MIGRATION*/');
    const sqlC = await writeTempSql('c.sql', 'CREATE TABLE IF NOT EXISTS {{SCHEMA}}.third_t (id INT);');

    const manifest = [
      { packageName: 'a', filename: 'a.sql', sqlPath: sqlA },
      { packageName: 'b', filename: 'b.sql', sqlPath: sqlB },
      { packageName: 'c', filename: 'c.sql', sqlPath: sqlC },
    ];

    const outcomes = await applyManifest(pool, VALID_SCHEMA, manifest);
    expect(outcomes.length).toBe(2);
    expect(outcomes[0]!.kind).toBe('applied');
    expect(outcomes[1]!.kind).toBe('failed');
    // The third migration should NOT have run.
    expect(pool.calls.find((c) => c.text.includes('third_t'))).toBeUndefined();
  });

  it('creates the tracker table before the first manifest entry', async () => {
    const pool = makeMockPool();
    const tracker = makeTrackerState();
    pool.on(/SELECT package, filename, checksum, applied_at/, (_t, params) => {
      const [pkg, file] = params as [string, string];
      const row = tracker.read(pkg, file);
      return row
        ? { rows: [{ package: pkg, filename: file, checksum: row.checksum, applied_at: '2026-05-26' }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    });
    pool.on(/INSERT INTO "tenant_.*"._migrations_applied/, (_t, params) => {
      const [pkg, file, cs] = params as [string, string, string];
      tracker.write(pkg, file, cs);
      return { rows: [], rowCount: 1 };
    });

    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);
    await applyManifest(pool, VALID_SCHEMA, [entry!]);

    const idxCreate = pool.calls.findIndex((c) =>
      c.text.includes(`CREATE TABLE IF NOT EXISTS "${VALID_SCHEMA}".${TRACKER_TABLE_NAME}`),
    );
    const idxApply = pool.calls.findIndex((c) => c.text.includes('sample_table'));
    expect(idxCreate).toBeGreaterThanOrEqual(0);
    expect(idxApply).toBeGreaterThan(idxCreate);
  });
});
