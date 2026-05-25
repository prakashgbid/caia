/**
 * Manifest loading for @caia/usage-steward.
 *
 * Two sources of expectations:
 *   1. Per-package — `package.json#caia.usage.{expectedImports,expectedExports}` OR
 *      sibling `usage.yaml`. package.json wins on conflict.
 *   2. Deploy manifest — `agent-memory/deploy_manifest.yaml` enumerates
 *      every deployed package.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type {
  DeployManifest, DeployManifestEntry,
  ExpectedExport, ExpectedImport, PackageExpectations,
} from './types.js';

const ExpectedImportSchema = z.object({
  consumer: z.string().min(1),
  symbol: z.string().min(1),
  package: z.string().min(1).optional(),
  optional: z.boolean().optional(),
  description: z.string().optional(),
});
const ExpectedExportSchema = z.object({
  symbol: z.string().min(1),
  optional: z.boolean().optional(),
  description: z.string().optional(),
});
const PackageUsageStanzaSchema = z.object({
  solutionId: z.string().optional(),
  expectedImports: z.array(ExpectedImportSchema).optional().default([]),
  expectedExports: z.array(ExpectedExportSchema).optional().default([]),
});
const PackageJsonSchema = z.object({
  name: z.string().min(1),
  caia: z.object({ usage: PackageUsageStanzaSchema.optional() }).optional(),
}).passthrough();
const UsageYamlSchema = z.object({
  packageName: z.string().min(1),
  solutionId: z.string().optional(),
  expectedImports: z.array(ExpectedImportSchema).optional().default([]),
  expectedExports: z.array(ExpectedExportSchema).optional().default([]),
});
const DeployManifestEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().optional(),
  solutionId: z.string().optional(),
}).passthrough().transform((raw): DeployManifestEntry => {
  const known = new Set(['name', 'path', 'solutionId']);
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!known.has(k)) metadata[k] = v;
  }
  return {
    name: raw.name,
    ...(raw.path !== undefined ? { path: raw.path } : {}),
    ...(raw.solutionId !== undefined ? { solutionId: raw.solutionId } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
});
const DeployManifestSchema = z.object({
  schema_version: z.number().int().nonnegative().default(1),
  entries: z.array(DeployManifestEntrySchema).default([]),
});

/** Load deploy_manifest.yaml. Missing file → empty manifest. */
export async function loadDeployManifest(manifestPath: string): Promise<DeployManifest> {
  let text: string;
  try {
    text = await fs.readFile(manifestPath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return { schemaVersion: 1, entries: [] };
    throw err;
  }
  const raw = text.trim() === '' ? {} : parseYaml(text);
  const parsed = DeployManifestSchema.parse(raw ?? {});
  return { schemaVersion: parsed.schema_version, entries: parsed.entries };
}

/** Load every package's expectations under packagesRoot. */
export async function loadPackageExpectations(packagesRoot: string): Promise<ReadonlyArray<PackageExpectations>> {
  let entries: string[];
  try {
    entries = await fs.readdir(packagesRoot);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const out: PackageExpectations[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const pkgDir = path.join(packagesRoot, entry);
    const stat = await fs.stat(pkgDir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const pkg = await loadPackageExpectation(pkgDir);
    if (pkg) out.push(pkg);
  }
  out.sort((a, b) => a.packageName.localeCompare(b.packageName));
  return out;
}

/**
 * Load one package's expectations. Always returns a row for any package
 * with a valid package.json#name — empty stanza becomes 'synthetic'.
 */
export async function loadPackageExpectation(packageDir: string): Promise<PackageExpectations | null> {
  const yamlPath = path.join(packageDir, 'usage.yaml');
  let yamlExp: PackageExpectations | null = null;
  if (await fileExists(yamlPath)) {
    const text = await fs.readFile(yamlPath, 'utf8');
    const parsed = UsageYamlSchema.parse(parseYaml(text));
    yamlExp = {
      packageName: parsed.packageName, packageDir,
      ...(parsed.solutionId !== undefined ? { solutionId: parsed.solutionId } : {}),
      source: 'usage.yaml',
      expectedImports: parsed.expectedImports.map(normImport),
      expectedExports: parsed.expectedExports.map(normExport),
    };
  }

  const pkgJsonPath = path.join(packageDir, 'package.json');
  let pkgJsonExp: PackageExpectations | null = null;
  let pkgName: string | undefined;
  if (await fileExists(pkgJsonPath)) {
    const text = await fs.readFile(pkgJsonPath, 'utf8');
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = PackageJsonSchema.safeParse(raw);
    if (!parsed.success) return null;
    pkgName = parsed.data.name;
    const stanza = parsed.data.caia?.usage;
    if (stanza && (stanza.expectedImports.length > 0 || stanza.expectedExports.length > 0)) {
      pkgJsonExp = {
        packageName: parsed.data.name, packageDir,
        ...(stanza.solutionId !== undefined ? { solutionId: stanza.solutionId } : {}),
        source: 'package.json',
        expectedImports: stanza.expectedImports.map(normImport),
        expectedExports: stanza.expectedExports.map(normExport),
      };
    }
  }
  if (pkgJsonExp) return pkgJsonExp;
  if (yamlExp) return yamlExp;
  if (pkgName) {
    return {
      packageName: pkgName, packageDir, source: 'synthetic',
      expectedImports: [], expectedExports: [],
    };
  }
  return null;
}

/** Inner-join expectations against the deploy manifest. */
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

export function declaredShippedNames(manifest: DeployManifest): ReadonlySet<string> {
  return new Set(manifest.entries.map((e) => e.name));
}

function normImport(raw: z.infer<typeof ExpectedImportSchema>): ExpectedImport {
  return {
    consumer: raw.consumer, symbol: raw.symbol,
    ...(raw.package !== undefined ? { package: raw.package } : {}),
    ...(raw.optional !== undefined ? { optional: raw.optional } : {}),
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  };
}
function normExport(raw: z.infer<typeof ExpectedExportSchema>): ExpectedExport {
  return {
    symbol: raw.symbol,
    ...(raw.optional !== undefined ? { optional: raw.optional } : {}),
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  };
}
async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
