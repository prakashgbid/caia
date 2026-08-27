/**
 * Shared Postgres pool for the wizard.
 *
 * Uses CAIA_WIZARD_DB env var (from /etc/chiefaia/wizard.env). One pg.Pool
 * per Node process — safe under Next.js dev / prod because the module is
 * evaluated once per worker.
 */

import { Pool } from 'pg';

const url = process.env.CAIA_WIZARD_DB;
if (!url && process.env.NODE_ENV === 'production') {
  // Don't crash the module import — routes will return 500 if they try to use it.
  // eslint-disable-next-line no-console
  console.warn('[wizard-db] CAIA_WIZARD_DB is not set; DB-backed routes will fail.');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { var __caiaWizardPool: Pool | undefined; }

export function db(): Pool {
  if (!globalThis.__caiaWizardPool) {
    globalThis.__caiaWizardPool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalThis.__caiaWizardPool!;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await db().query<T>(sql, params as unknown[]);
  return res.rows;
}
