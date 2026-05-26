import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Belt-and-braces tests asserting AUDIT.md §2's shape invariants on
 * every per-tenant migration. If a future PR ever ships a per-tenant
 * migration without `{{SCHEMA}}`, these tests fire immediately.
 */

const PER_TENANT_PACKAGES = [
  { pkg: '@caia/grand-idea', file: '001_grand_ideas.sql' },
  { pkg: '@caia/interviewer', file: '0001_interviewer.sql' },
  { pkg: '@caia/info-architect', file: '0001_info_architect.sql' },
  { pkg: '@caia/business-proposal-generator', file: '0001_business_proposals.sql' },
  { pkg: '@caia-app/dashboard', file: '0010_wizard_state.sql' },
] as const;

const GLOBAL_PACKAGES = [
  { pkg: '@caia/state-machine', file: '0001_state_machine.sql' },
  { pkg: '@caia/onboarding', file: '0001_caia_meta_init.sql' },
  { pkg: '@caia/design-ingest', file: '0001_ux_uploads.sql' },
  { pkg: '@caia-app/dashboard', file: '0011_tenants_global.sql' },
] as const;

function migrationPath(packageName: string, filename: string): string {
  const pkgJson = require.resolve(`${packageName}/package.json`);
  return join(dirname(pkgJson), 'migrations', filename);
}

describe('per-tenant migrations conform to AUDIT.md §2', () => {
  for (const { pkg, file } of PER_TENANT_PACKAGES) {
    it(`${pkg}/${file} contains the {{SCHEMA}} placeholder`, async () => {
      const sql = await readFile(migrationPath(pkg, file), 'utf8');
      expect(sql).toMatch(/\{\{SCHEMA\}\}/);
    });

    it(`${pkg}/${file} uses idempotent guards (CREATE IF NOT EXISTS)`, async () => {
      const sql = await readFile(migrationPath(pkg, file), 'utf8');
      // Every per-tenant migration must be re-runnable.
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS|CREATE SCHEMA IF NOT EXISTS/);
    });
  }
});

describe('global migrations do NOT use {{SCHEMA}} (AUDIT.md §4 Blocker 2)', () => {
  for (const { pkg, file } of GLOBAL_PACKAGES) {
    it(`${pkg}/${file} does NOT contain {{SCHEMA}}`, async () => {
      const sql = await readFile(migrationPath(pkg, file), 'utf8');
      expect(sql).not.toMatch(/\{\{SCHEMA\}\}/);
    });
  }
});
