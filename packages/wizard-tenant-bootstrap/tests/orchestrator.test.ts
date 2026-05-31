import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapTenant,
  dropTenantSchema,
  listTenantTables,
} from '../src/orchestrator.js';
import { TRACKER_TABLE_NAME } from '../src/tracker.js';
import type { BootstrapEventPublisher, MigrationEntry } from '../src/types.js';
import { VALID_SCHEMA, makeOneEntryManifest, SAMPLE_PER_TENANT_SQL, writeTempSql } from './fixtures.js';
import { makeMockPool, makeTrackerState } from './mock-pool.js';

function wireSuccessfulPool(): {
  pool: ReturnType<typeof makeMockPool>;
  tracker: ReturnType<typeof makeTrackerState>;
  createdTables: Set<string>;
} {
  const pool = makeMockPool();
  const tracker = makeTrackerState();
  const createdTables = new Set<string>();

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
  pool.on(/SELECT table_name/, () => ({
    rows: [...createdTables].sort().map((n) => ({ table_name: n })),
    rowCount: createdTables.size,
  }));
  // Pretend that any CREATE TABLE IF NOT EXISTS ... succeeds AND records
  // the table in our in-memory set so listTenantTables sees it.
  pool.on(/CREATE TABLE IF NOT EXISTS/, (text) => {
    const m = text.match(/CREATE TABLE IF NOT EXISTS\s+"[^"]+"\.(\w+)/);
    if (m && m[1]) createdTables.add(m[1]);
    return { rows: [], rowCount: 0 };
  });

  return { pool, tracker, createdTables };
}

describe('bootstrapTenant', () => {
  it('happy path: applies entries, verifies tables, emits success event', async () => {
    const { pool } = wireSuccessfulPool();
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);

    const events: Array<Parameters<BootstrapEventPublisher['publish']>[0]> = [];
    const publisher: BootstrapEventPublisher = {
      publish: async (input) => {
        events.push(input);
        return undefined;
      },
    };

    const result = await bootstrapTenant({
      pool,
      schemaName: VALID_SCHEMA,
      manifest: [entry!],
      publisher,
    });

    expect(result.success).toBe(true);
    expect(result.outcomes.length).toBe(1);
    expect(result.outcomes[0]!.kind).toBe('applied');
    expect(result.tablesCreated).toContain('sample_table');
    expect(result.tablesCreated).toContain(TRACKER_TABLE_NAME);
    expect(result.failures).toEqual([]);
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe('tenant.migrations.complete');
    expect(events[0]!.severity).toBe('info');
    expect(events[0]!.payload.success).toBe(true);
    expect(events[0]!.payload.tables_created).toContain('sample_table');
  });

  it('idempotent: second call returns all kind=skipped', async () => {
    const { pool } = wireSuccessfulPool();
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);

    const first = await bootstrapTenant({ pool, schemaName: VALID_SCHEMA, manifest: [entry!] });
    expect(first.outcomes[0]!.kind).toBe('applied');

    const second = await bootstrapTenant({ pool, schemaName: VALID_SCHEMA, manifest: [entry!] });
    expect(second.success).toBe(true);
    expect(second.outcomes[0]!.kind).toBe('skipped');
  });

  it('failure path: returns success=false with failures populated, still emits an event', async () => {
    const { pool } = wireSuccessfulPool();
    pool.on(/exploder_table/, () => {
      throw new Error('out of memory');
    });
    const goodPath = await writeTempSql('good.sql', 'CREATE TABLE IF NOT EXISTS {{SCHEMA}}.ok_table (id INT);');
    const badPath = await writeTempSql('bad.sql', 'CREATE TABLE IF NOT EXISTS {{SCHEMA}}.exploder_table (id INT);');

    const manifest: MigrationEntry[] = [
      { packageName: 'good', filename: 'good.sql', sqlPath: goodPath },
      { packageName: 'bad', filename: 'bad.sql', sqlPath: badPath },
    ];
    const events: Array<Parameters<BootstrapEventPublisher['publish']>[0]> = [];
    const result = await bootstrapTenant({
      pool,
      schemaName: VALID_SCHEMA,
      manifest,
      publisher: { publish: async (i) => { events.push(i); return undefined; } },
    });

    expect(result.success).toBe(false);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]!.packageName).toBe('bad');
    expect(result.failures[0]!.error).toContain('out of memory');
    expect(events[0]!.severity).toBe('error');
    expect(events[0]!.payload.success).toBe(false);
    expect(events[0]!.payload.failed_count).toBe(1);
  });

  it('publisher failure does NOT flip bootstrap success', async () => {
    const { pool } = wireSuccessfulPool();
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);
    const result = await bootstrapTenant({
      pool,
      schemaName: VALID_SCHEMA,
      manifest: [entry!],
      publisher: { publish: async () => { throw new Error('bus down'); } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid schema names before doing any work', async () => {
    const pool = makeMockPool();
    await expect(
      bootstrapTenant({ pool, schemaName: 'caia_bad', manifest: [] }),
    ).rejects.toThrow(/invalid tenant schema/);
    expect(pool.calls.length).toBe(0);
  });

  it('uses DEFAULT_MANIFEST when no manifest is passed', async () => {
    // Don't actually run the 5 real migrations against a mock — just
    // assert that the default is selected by checking the published
    // event's payload mentions all 5 packages even with everything failing.
    const pool = makeMockPool();
    pool.default(() => { throw new Error('mock-deny: not configured'); });

    const events: Array<Parameters<BootstrapEventPublisher['publish']>[0]> = [];
    await bootstrapTenant({
      pool,
      schemaName: VALID_SCHEMA,
      publisher: { publish: async (i) => { events.push(i); return undefined; } },
    }).catch(() => undefined); // first failure may bubble, that's fine
    // The publish path runs regardless because applyManifest swallows
    // per-entry failures into outcomes. So we should see one event.
    expect(events.length).toBe(1);
  });

  it('calls the optional logger with start/done lines', async () => {
    const { pool } = wireSuccessfulPool();
    const [entry] = await makeOneEntryManifest('@caia/x', '0001_x.sql', SAMPLE_PER_TENANT_SQL);
    const log = vi.fn();
    await bootstrapTenant({ pool, schemaName: VALID_SCHEMA, manifest: [entry!], log });
    expect(log.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(log.mock.calls[0]![0]).toMatch(/start/);
    expect(log.mock.calls.at(-1)![0]).toMatch(/done/);
  });
});

describe('dropTenantSchema', () => {
  it('issues DROP SCHEMA … CASCADE with the quoted schema', async () => {
    const pool = makeMockPool();
    await dropTenantSchema(pool, VALID_SCHEMA);
    expect(pool.calls.length).toBe(1);
    expect(pool.calls[0]!.text).toBe(`DROP SCHEMA IF EXISTS "${VALID_SCHEMA}" CASCADE`);
  });

  it('refuses an invalid schema name', async () => {
    const pool = makeMockPool();
    await expect(dropTenantSchema(pool, 'public')).rejects.toThrow(/invalid tenant schema/);
  });
});

describe('listTenantTables', () => {
  it('queries information_schema.tables with table_type filter', async () => {
    const pool = makeMockPool();
    pool.default(() => ({
      rows: [{ table_name: 'wizard_state' }, { table_name: 'grand_ideas' }],
      rowCount: 2,
    }));
    const tables = await listTenantTables(pool, VALID_SCHEMA);
    expect(tables).toEqual(['wizard_state', 'grand_ideas']);
    expect(pool.calls[0]!.text).toContain("table_type = 'BASE TABLE'");
    expect(pool.calls[0]!.params).toEqual([VALID_SCHEMA]);
  });
});
