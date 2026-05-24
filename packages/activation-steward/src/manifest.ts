/**
 * Manifest loading for @caia/activation-steward.
 *
 * Two sources of `expectedCallPaths`:
 *
 * 1. **Per-package** — each package may declare
 *    `caia.activation.expectedCallPaths[]` in its `package.json` OR ship
 *    a sibling `activation.yaml` file. `package.json` wins on conflict.
 *
 * 2. **Deploy manifest** — `agent-memory/deploy_manifest.yaml` is the
 *    canonical list of deployed entries. We join package-level
 *    expectations against this list so we don't waste a TraceQL query
 *    on packages that haven't been deployed yet.
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
  ExpectedCallPath,
  PackageExpectations,
} from './types.js';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const ExpectedCallPathSchema = z.object({
  path: z.string().min(1),
  serviceName: z.string().min(1),
  spanName: z.string().min(1).optional(),
  freshnessHours: z.number().positive().optional(),
  optional: z.boolean().optional(),
  description: z.string().optional(),
});

const PackageActivationStanzaSchema = z.object({
  solutionId: z.string().optional(),
  expectedCallPaths: z.array(ExpectedCallPathSchema).min(0),
});

const PackageJsonSchema = z
  .object({
    name: z.string().min(1),
    caia: z
      .object({
        activation: PackageActivationStanzaSchema.optional(),
      })
      .optional(),
  })
  .passthrough();

const ActivationYamlSchema = z.object({
  packageName: z.string().min(1),
  solutionId: z.string().optional(),
  expectedCallPaths: z.array(ExpectedCallPathSchema).min(0),
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
 * file is missing — the activation steward must work on fresh sites.
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
 * Load every package's expected call-paths under `packagesRoot`. Skips
 * packages that have no `caia.activation` stanza and no
 * `activation.yaml`.
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
  // 1. Try activation.yaml first (it declares packageName explicitly).
  const yamlPath = path.join(packageDir, 'activation.yaml');
  const yamlExists = await fileExists(yamlPath);
  let yamlExp: PackageExpectations | null = null;
  if (yamlExists) {
    const text = await fs.readFile(yamlPath, 'utf8');
    const raw = parseYaml(text);
    const parsed = ActivationYamlSchema.parse(raw);
    yamlExp = {
      packageName: parsed.packageName,
      ...(parsed.solutionId !== undefined ? { solutionId: parsed.solutionId } : {}),
      source: 'activation.yaml',
      expectedCallPaths: parsed.expectedCallPaths.map(normaliseCallPath),
    };
  }

  // 2. Try package.json.caia.activation.
  const pkgJsonPath = path.join(packageDir, 'package.json');
  const pkgJsonExists = await fileExists(pkgJsonPath);
  let pkgJsonExp: PackageExpectations | null = null;
  if (pkgJsonExists) {
    const text = await fs.readFile(pkgJsonPath, 'utf8');
    const raw: unknown = JSON.parse(text);
    const parsed = PackageJsonSchema.parse(raw);
    const stanza = parsed.caia?.activation;
    if (stanza && stanza.expectedCallPaths.length > 0) {
      pkgJsonExp = {
        packageName: parsed.name,
        ...(stanza.solutionId !== undefined ? { solutionId: stanza.solutionId } : {}),
        source: 'package.json',
        expectedCallPaths: stanza.expectedCallPaths.map(normaliseCallPath),
      };
    }
  }

  // package.json wins on conflict.
  return pkgJsonExp ?? yamlExp;
}

/**
 * Inner join: keep only package expectations whose package is also in
 * the deploy manifest. Returns `[entry, expectations]` pairs.
 *
 * If `deployManifest.entries` is empty, falls back to returning every
 * expectation (treats a missing manifest as "deploy everything").
 */
export function joinManifestAndExpectations(
  manifest: DeployManifest,
  expectations: ReadonlyArray<PackageExpectations>,
): ReadonlyArray<{ entry: DeployManifestEntry | null; expectations: PackageExpectations }> {
  if (manifest.entries.length === 0) {
    return expectations.map((e) => ({ entry: null, expectations: e }));
  }
  const byName = new Map(manifest.entries.map((e) => [e.name, e] as const));
  const out: Array<{ entry: DeployManifestEntry | null; expectations: PackageExpectations }> = [];
  for (const exp of expectations) {
    const entry = byName.get(exp.packageName);
    if (!entry) continue;
    out.push({ entry, expectations: exp });
  }
  return out;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function normaliseCallPath(raw: z.infer<typeof ExpectedCallPathSchema>): ExpectedCallPath {
  const spanName = raw.spanName ?? defaultSpanName(raw.path);
  return {
    path: raw.path,
    serviceName: raw.serviceName,
    spanName,
    freshnessHours: raw.freshnessHours ?? 24,
    optional: raw.optional ?? false,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  };
}

function defaultSpanName(path: string): string {
  // Conventionally the path is "<pkg>:<Class>.<method>" — take the last
  // segment after ':' (or fall back to the path itself).
  const idx = path.indexOf(':');
  return idx >= 0 ? path.slice(idx + 1) : path;
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
