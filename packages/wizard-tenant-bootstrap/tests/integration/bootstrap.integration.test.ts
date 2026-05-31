/**
 * Integration test — real Postgres. Gated by `PG_INTEGRATION_URL`.
 *
 * Bring-up:
 *   docker compose -f docker-compose.test.yml up -d
 *   PG_INTEGRATION_URL=postgres://caia:caia@localhost:54322/caia_test \
 *     pnpm --filter @caia/wizard-tenant-bootstrap test:integration
 *   docker compose -f docker-compose.test.yml down -v
 *
 * The test uses a fresh, unique schema name per case so cases don't
 * collide if run concurrently or repeated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

import { bootstrapTenant, dropTenantSchema, listTenantTables } from '../../src/orchestrator.js';
import { DEFAULT_MANIFEST } from '../../src/manifest.js';

const PG_URL = process.env.PG_INTEGRATION_URL;

function uniqueSchema(): string {
  return `tenant_int_${randomBytes(4).toString('hex')}`;
}

describe.skipIf(!PG_URL)('@caia/wizard-tenant-bootstrap — real Postgres', () => {
  let pool: Pool;
  const created: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
    // Provide pgcrypto + citext so the migrations succeed.
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
  }, 60_000);

  afterAll(async () => {
    if (!pool) return;
    for (const s of created) {
      await pool.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
    }
    await pool.end();
  });

  it('populates a fresh tenant schema with every per-tenant table', async () => {
    const schema = uniqueSchema();
    created.push(schema);
    const result = await bootstrapTenant({ pool, schemaName: schema });
    expect(result.success).toBe(true);

    const tables = await listTenantTables(pool, schema);
    // Expected per AUDIT.md §1 (per-tenant set):
    //   grand_ideas, interviews, interview_turns, business_plan_revisions,
    //   interview_deferred, pages_catalogue, design_systems,
    //   components_library, business_proposals, designapp_prompts,
    //   proposal_revisions, wizard_state, + _migrations_applied
    for (const expected of [
      'grand_ideas',
      'interviews',
      'interview_turns',
      'business_plan_revisions',
      'interview_deferred',
      'pages_catalogue',
      'design_systems',
      'components_library',
      'business_proposals',
      'designapp_prompts',
      'proposal_revisions',
      'wizard_state',
      '_migrations_applied',
    ]) {
      expect(tables, `${expected} missing from ${schema}`).toContain(expected);
    }
  });

  it('is idempotent — second bootstrap is all skipped', async () => {
    const schema = uniqueSchema();
    created.push(schema);
    const first = await bootstrapTenant({ pool, schemaName: schema });
    expect(first.success).toBe(true);

    const second = await bootstrapTenant({ pool, schemaName: schema });
    expect(second.success).toBe(true);
    for (const o of second.outcomes) {
      expect(o.kind).toBe('skipped');
    }
  });

  it('dropTenantSchema removes everything including the tracker', async () => {
    const schema = uniqueSchema();
    await bootstrapTenant({ pool, schemaName: schema });
    expect((await listTenantTables(pool, schema)).length).toBeGreaterThan(0);
    await dropTenantSchema(pool, schema);
    // After drop, information_schema returns nothing for that schema.
    const res = await pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [schema],
    );
    expect(res.rowCount).toBe(0);
  });

  it('DEFAULT_MANIFEST has 5 entries (sanity)', () => {
    expect(DEFAULT_MANIFEST.length).toBe(5);
  });
});
