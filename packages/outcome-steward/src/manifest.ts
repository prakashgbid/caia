/**
 * Manifest loading for @caia/outcome-steward.
 *
 * Two sources of `expectedSli[]`:
 *
 * 1. **Per-package** — each package may declare
 *    `caia.outcome.expectedSli[]` in its `package.json` OR ship a
 *    sibling `outcome.yaml` file. `package.json` wins on conflict.
 *
 * 2. **Deploy manifest** — `agent-memory/deploy_manifest.yaml` is the
 *    canonical list of deployed entries. We join package-level
 *    expectations against this list so we don't query metrics for
 *    packages that haven't been deployed yet.
 *
 * Both loaders are pure async functions over the filesystem; tests
 * exercise them via tmpdir fixtures, no mocks needed.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type {
  DeployManifest,
  DeployManifestEntry,
  ExpectedSli,
  PackageExpectations,
} from './types.js';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const ExpectedSliSchema = z.object({
  metric: z.string().min(1),
  query: z.string().min(1),
  threshold: z.number(),
  direction: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']),
  trendDirection: z.enum(['up', 'down', 'flat', 'any']).optional(),
  freshnessHours: z.number().positive().optional(),
  optional: z.boolean().optional(),
  description: z.string().optional(),
});

const PackageOutcomeStanzaSchema = z.object({
  solutionId: z.string().optional(),
  expectedSli: z.array(ExpectedSliSchema).min(0),
});

const PackageJsonSchema = z
  .object({
    name: z.string().min(1),
    caia: z
      .object({
        outcome: PackageOutcomeStanzaSchema.optional(),
      })
      .optional(),
  })
  .passthrough();

const OutcomeYamlSchema = z.object({
  packageName: z.string().min(1),
  solutionId: z.string().optional(),
  expectedSli: z.array(ExpectedSliSchema).min(0),
});

const DeployManifestEntrySchema = z
  .object({
    name: z.string().min(1),
    path: z.string().optional(),
    solutionId: z.string().optional(),
  })
  .passthrough()
  .transform((raw) => {
    const known = new Set(['name', 'path', 'solutionId']);
    const metadata: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!known.has(k)) metadata[k] = v;
    }
    const out: DeployManifestEntry = {
      name: raw.name,
      ...(raw.path !== undefined ? { path: raw.path } : {}),
      ...(raw.solutionId !== undefined ? { solutionId: raw.solutionId } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
    return out;
  });

const DeployManifestSchema = z.object({
  schema_version: z.number().int().nonnegative().default(1),
  entries: z.array(DeployManifestEntrySchema).default([]),
});

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Load `deploy_manifest.yaml`. Returns an empty-entries manifest if the
 * file is missing — the outcome steward must work on fresh sites.
 */
export async function loadDeployManifest(manifestPath: string): Promise<DeployManifest> {
  let text: string;
  try {
    text = await fs.readFile(manifestPath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) {
      return { schemaVersion: 1, entries: [] };
    }
    throw err;
  }

  const raw = text.trim() === '' ? {} : parseYaml(text);
  const parsed = DeployManifestSchema.parse(raw ?? {});
  return {
    schemaVersion: parsed.schema_version,
    entries: parsed.entries,
  };
}

/**
 * Load every package's expected SLIs under `packagesRoot`. Skips
 * packages that have neither a `caia.outcome` stanza nor an
 * `outcome.yaml`.
 *
 * Graceful degradation: a package with no declaration is simply not
 * returned; the cross-checker emits a synthetic `no-metric-declared`
 * row for any deploy-manifest entry not present here.
 */
export async function loadPackageExpectations(
  packagesRoot: string,
): Promise<ReadonlyArray<PackageExpectations>> {
  let entries: string[];
  try {
    entries = await fs.readdir(packagesRoot);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }

  const out: PackageExpectations[] = [];
  for (const entry of entries) {
    const pkgDir = path.join(packagesRoot, entry);
    const stat = await fs.stat(pkgDir).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const pkg = await loadPackageExpectation(pkgDir);
    if (pkg) out.push(pkg);
  }
  out.sort((a, b) => a.packageName.localeCompare(b.packageName));
  return out;
}

/** Load one package's expectations. Returns `null` if no declaration found. */
export async function loadPackageExpectation(
  packageDir: string,
): Promise<PackageExpectations | null> {
  // 1. Try outcome.yaml first (it declares packageName explicitly).
  const yamlPath = path.join(packageDir, 'outcome.yaml');
  const yamlExists = await fileExists(yamlPath);
  let yamlExp: PackageExpectations | null = null;
  if (yamlExists) {
    const text = await fs.readFile(yamlPath, 'utf8');
    const raw = parseYaml(text);
    const parsed = OutcomeYamlSchema.parse(raw);
    yamlExp = {
      packageName: parsed.packageName,
      ...(parsed.solutionId !== undefined ? { solutionId: parsed.solutionId } : {}),
      source: 'outcome.yaml',
      expectedSli: parsed.expectedSli.map(normaliseSli),
    };
  }

  // 2. Try package.json.caia.outcome.
  const pkgJsonPath = path.join(packageDir, 'package.json');
  const pkgJsonExists = await fileExists(pkgJsonPath);
  let pkgJsonExp: PackageExpectations | null = null;
  if (pkgJsonExists) {
    const text = await fs.readFile(pkgJsonPath, 'utf8');
    const raw: unknown = JSON.parse(text);
    const parsed = PackageJsonSchema.parse(raw);
    const stanza = parsed.caia?.outcome;
    if (stanza && stanza.expectedSli.length > 0) {
      pkgJsonExp = {
        packageName: parsed.name,
        ...(stanza.solutionId !== undefined ? { solutionId: stanza.solutionId } : {}),
        source: 'package.json',
        expectedSli: stanza.expectedSli.map(normaliseSli),
      };
    }
  }

  // package.json wins on conflict.
  return pkgJsonExp ?? yamlExp;
}

/**
 * Join the manifest entries with the loaded expectations.
 *
 * Returns one row per deploy-manifest entry, carrying the loaded
 * expectations if any (else `null`). The cross-checker uses the `null`
 * branch to emit a synthetic `no-metric-declared` row — which is the
 * graceful-degradation contract from spec §4.3.
 *
 * If `deployManifest.entries` is empty, falls back to returning every
 * expectation (treats a missing manifest as "deploy everything").
 */
export function joinManifestAndExpectations(
  manifest: DeployManifest,
  expectations: ReadonlyArray<PackageExpectations>,
): ReadonlyArray<{ entry: DeployManifestEntry | null; expectations: PackageExpectations | null; packageName: string }> {
  if (manifest.entries.length === 0) {
    return expectations.map((e) => ({
      entry: null,
      expectations: e,
      packageName: e.packageName,
    }));
  }
  const expByName = new Map(expectations.map((e) => [e.packageName, e] as const));
  const out: Array<{ entry: DeployManifestEntry | null; expectations: PackageExpectations | null; packageName: string }> = [];
  for (const entry of manifest.entries) {
    const exp = expByName.get(entry.name) ?? null;
    out.push({ entry, expectations: exp, packageName: entry.name });
  }
  return out;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function normaliseSli(raw: z.infer<typeof ExpectedSliSchema>): ExpectedSli {
  return {
    metric: raw.metric,
    query: raw.query,
    threshold: raw.threshold,
    direction: raw.direction,
    trendDirection: raw.trendDirection ?? 'any',
    freshnessHours: raw.freshnessHours ?? 24,
    optional: raw.optional ?? false,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
