/**
 * The canonical per-tenant migration manifest.
 *
 * Each entry points at a SQL file that uses `{{SCHEMA}}` as a placeholder
 * for the per-tenant Postgres schema. The orchestrator applies them in
 * the listed order — `_migrations_applied` first (created by the runner),
 * then the per-step package migrations, then the dashboard's wizard_state
 * table.
 *
 * **Out of scope** (intentionally NOT here, per AUDIT.md §2):
 *   - `@caia/state-machine/migrations/000{1,2,3}_*.sql`     — global, `caia_meta` schema
 *   - `@caia/onboarding/migrations/0001_caia_meta_init.sql` — global, `caia_meta` schema
 *   - `@caia/design-ingest/migrations/0001_ux_uploads.sql`  — global, row-level `tenant_id` scoping (deliberate; see AUDIT.md Blocker 2)
 *   - `apps/dashboard/migrations/0011_tenants_global.sql`   — global `tenants` lookup table
 *
 * The list is computed lazily (via `getDefaultManifest()`) so the package
 * paths are resolved at runtime, not at module-load time. This avoids
 * forcing the workspace to be `pnpm install`-ed for `import`-only sites
 * (like the bootstrap-skipped legacy admin path in dashboard tests).
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { MigrationEntry } from './types.js';

const require = createRequire(import.meta.url);

/**
 * Resolve the on-disk path to a workspace package's `package.json` and
 * return its directory. We don't import the package's JS — we just need
 * to find its `migrations/` folder.
 */
function packageDir(packageName: string): string {
  const pkgJsonPath = require.resolve(`${packageName}/package.json`);
  return dirname(pkgJsonPath);
}

/**
 * Returns the canonical per-tenant migration manifest. Throws if any
 * workspace dep isn't installed (which would indicate the bootstrap
 * package was used outside the monorepo, which is unsupported).
 *
 * Order matters: each package's migration is idempotent in isolation,
 * but applying them in a deterministic order makes test diffs stable
 * and makes the `_migrations_applied` ledger replay-friendly.
 */
export function getDefaultManifest(): ReadonlyArray<MigrationEntry> {
  return [
    {
      packageName: '@caia/grand-idea',
      filename: '001_grand_ideas.sql',
      sqlPath: join(packageDir('@caia/grand-idea'), 'migrations', '001_grand_ideas.sql'),
    },
    {
      packageName: '@caia/interviewer',
      filename: '0001_interviewer.sql',
      sqlPath: join(packageDir('@caia/interviewer'), 'migrations', '0001_interviewer.sql'),
    },
    {
      packageName: '@caia/info-architect',
      filename: '0001_info_architect.sql',
      sqlPath: join(packageDir('@caia/info-architect'), 'migrations', '0001_info_architect.sql'),
    },
    {
      packageName: '@caia/business-proposal-generator',
      filename: '0001_business_proposals.sql',
      sqlPath: join(
        packageDir('@caia/business-proposal-generator'),
        'migrations',
        '0001_business_proposals.sql',
      ),
    },
    {
      packageName: '@caia-app/dashboard',
      filename: '0010_wizard_state.sql',
      // The dashboard isn't a published package, but it IS a workspace
      // member, so `require.resolve` succeeds when the dashboard ships
      // its `package.json` in the workspace (it does). We resolve relative
      // to its `package.json` for stability.
      sqlPath: join(packageDir('@caia-app/dashboard'), 'migrations', '0010_wizard_state.sql'),
    },
  ];
}

/**
 * Eagerly-evaluated default manifest. Most consumers want this — the
 * lazy form is exported for tests + alternate-workspace callers.
 *
 * If you're stubbing the manifest for tests, pass your custom entries
 * via `BootstrapOptions.manifest` instead of re-exporting.
 */
export const DEFAULT_MANIFEST: ReadonlyArray<MigrationEntry> = getDefaultManifest();
