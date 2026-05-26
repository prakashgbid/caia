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
 * Resolution strategy: walk up from this file's `import.meta.url` to find
 * the monorepo root (the directory containing `pnpm-workspace.yaml`), then
 * join the package-relative path. We deliberately avoid
 * `require.resolve('${pkg}/package.json')` because several workspace
 * packages (state-machine, onboarding, etc.) don't expose `./package.json`
 * in their `exports` field and Node-20 ESM-strict throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MigrationEntry } from './types.js';

/**
 * Walk up from `startDir` to find the directory that contains
 * `pnpm-workspace.yaml`. Throws if not found (which means the package
 * is being used outside the monorepo — unsupported for now).
 */
function findMonorepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `@caia/wizard-tenant-bootstrap: pnpm-workspace.yaml not found walking up from ${startDir}. ` +
      `This package only works inside the caia monorepo.`,
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = findMonorepoRoot(HERE);

/** Package-name → on-disk directory inside the monorepo. */
function packageDir(packageName: string): string {
  // `@caia/<name>` → `packages/<name>`
  // `@caia-app/<name>` → `apps/<name>`
  // Anything else → walk packages/, apps/ trying the bare name.
  if (packageName.startsWith('@caia/')) {
    return join(MONOREPO_ROOT, 'packages', packageName.slice('@caia/'.length));
  }
  if (packageName.startsWith('@caia-app/')) {
    return join(MONOREPO_ROOT, 'apps', packageName.slice('@caia-app/'.length));
  }
  // Defence-in-depth — try both.
  for (const sub of ['packages', 'apps', 'services', 'configs']) {
    const candidate = join(MONOREPO_ROOT, sub, packageName);
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error(
    `@caia/wizard-tenant-bootstrap: cannot locate workspace package "${packageName}" under ${MONOREPO_ROOT}`,
  );
}

/**
 * Returns the canonical per-tenant migration manifest.
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

/** Internal helper exposed for the audit-shape tests. */
export function _packageDir(packageName: string): string {
  return packageDir(packageName);
}
