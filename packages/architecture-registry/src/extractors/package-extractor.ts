/**
 * @chiefaia/architecture-registry — package.json + pnpm-workspace scanner
 * (ARCH-003)
 *
 * Walks every package in the monorepo (apps/* + packages/* + templates/site-*)
 * and emits one `arch_artifacts` row per workspace member with `kind='package'`
 * + `PackageMetadata`. Reverse-deps (`consumers`) are computed by scanning all
 * packages' `dependencies` for workspace:* references.
 *
 * Outputs:
 *   - `arch_artifacts` rows for each internal workspace member
 *   - `arch_artifacts` rows for each unique external dependency (deduped)
 *   - `arch_edges` (relation = 'depends_on') for every internal-→-anything dep
 */

import { nanoid } from 'nanoid';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArchArtifactRowSchema,
  ArchEdgeRowSchema,
  PackageMetadataSchema,
  type ArchArtifactRow,
  type ArchEdgeRow,
  type PackageMetadata,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_VERSION,
} from '../schema';
import { computeArtifactDedupKey, computeEdgeDedupKey } from '../dedup-key';
import type { ExtractionResult, ExtractorOptions } from './ts-morph-types';

interface PackageJsonShape {
  name?: string;
  version?: string;
  description?: string;
  private?: boolean;
  main?: string;
  types?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const WORKSPACE_DIRS = ['apps', 'packages', 'templates'];

function readPkg(folder: string): PackageJsonShape | undefined {
  const path = join(folder, 'package.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

function isInternalRef(ref: string): boolean {
  return ref.startsWith('workspace:') || ref.startsWith('link:');
}

function listWorkspaceFolders(repoRoot: string): string[] {
  const out: string[] = [];
  for (const ws of WORKSPACE_DIRS) {
    const wsRoot = join(repoRoot, ws);
    if (!existsSync(wsRoot)) continue;
    let entries: string[];
    try {
      entries = readdirSync(wsRoot);
    } catch {
      continue;
    }
    for (const e of entries) {
      const folder = join(wsRoot, e);
      let st;
      try {
        st = statSync(folder);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (existsSync(join(folder, 'package.json'))) {
        out.push(folder);
      }
    }
  }
  return out;
}

interface InternalEntry {
  folder: string;
  rel: string;
  pkg: PackageJsonShape;
  artifactId: string;
}

export function extractPackagesFromMonorepo(opts: ExtractorOptions): ExtractionResult {
  const result: ExtractionResult = { artifacts: [], edges: [], warnings: [] };
  const newId = opts.newId ?? ((p) => `${p}_${nanoid(12)}`);
  const folders = listWorkspaceFolders(opts.repoRoot);
  if (folders.length === 0) {
    result.warnings.push(`package-extractor: no workspace folders found under ${opts.repoRoot}`);
    return result;
  }

  // Pass 1: build internal entries (each gets an artifactId).
  const internals: InternalEntry[] = [];
  const internalsByName = new Map<string, InternalEntry>();
  for (const folder of folders) {
    const pkg = readPkg(folder);
    if (!pkg?.name) continue;
    const rel = relativize(opts.repoRoot, folder);
    const id = newId('arch');
    const entry: InternalEntry = { folder, rel, pkg, artifactId: id };
    internals.push(entry);
    internalsByName.set(pkg.name, entry);
  }

  // Pass 2: compute reverse-deps. For each internal package, list which other
  // internal packages list it in dependencies/devDependencies as workspace:*.
  const consumersOf = new Map<string, Set<string>>();
  for (const consumer of internals) {
    const allDeps = {
      ...(consumer.pkg.dependencies ?? {}),
      ...(consumer.pkg.devDependencies ?? {}),
    };
    for (const [depName, depRef] of Object.entries(allDeps)) {
      if (!isInternalRef(depRef)) continue;
      const set = consumersOf.get(depName) ?? new Set<string>();
      set.add(consumer.pkg.name!);
      consumersOf.set(depName, set);
    }
  }

  // Pass 3: emit one artifact per internal package.
  const externalArtifactIds = new Map<string, string>(); // packageName → artifactId

  for (const entry of internals) {
    const { pkg, rel, artifactId } = entry;
    try {
      const internal = true;
      const deps = Object.keys(pkg.dependencies ?? {});
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      const consumers = Array.from(consumersOf.get(pkg.name!) ?? new Set());

      const meta: PackageMetadata = PackageMetadataSchema.parse({
        version: pkg.version ?? '0.0.0',
        internal,
        dependencies: deps,
        devDependencies: devDeps,
        consumers,
        isPrivate: pkg.private === true,
        ...(pkg.main ? { entryPoint: pkg.main } : {}),
      });

      const dedupKey = computeArtifactDedupKey({
        project: opts.defaultProject,
        kind: 'package',
        name: pkg.name!,
        packageName: pkg.name!,
      });

      const artifact: ArchArtifactRow = ArchArtifactRowSchema.parse({
        id: artifactId,
        kind: 'package',
        project: opts.defaultProject,
        name: pkg.name!,
        description: pkg.description ?? `Internal workspace package ${pkg.name} at ${rel}.`,
        filePaths: [rel],
        entryPath: rel,
        packageName: pkg.name!,
        techSubDomains: inferTechSubDomainsForPackage(pkg.name!, rel),
        tags: pkg.private ? ['internal', 'private'] : ['internal'],
        metadataJson: JSON.stringify(meta),
        source: 'package_scan',
        extractedAtCommit: opts.extractedAtCommit,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        embeddingDim: DEFAULT_EMBEDDING_DIM,
        embeddingVersion: DEFAULT_EMBEDDING_VERSION,
        createdAt: opts.now,
        updatedAt: opts.now,
        dedupKey,
      });
      result.artifacts.push(artifact);
    } catch (err) {
      result.warnings.push(`package-extractor: ${rel} → ${(err as Error).message}`);
    }
  }

  // Pass 4: emit external-package artifacts (lazy — only for packages that
  // are referenced as deps by ≥1 internal package).
  const externalNames = new Set<string>();
  for (const entry of internals) {
    for (const [d] of Object.entries(entry.pkg.dependencies ?? {})) {
      if (!internalsByName.has(d)) externalNames.add(d);
    }
    for (const [d] of Object.entries(entry.pkg.devDependencies ?? {})) {
      if (!internalsByName.has(d)) externalNames.add(d);
    }
  }
  for (const ext of externalNames) {
    const id = newId('arch');
    externalArtifactIds.set(ext, id);
    const meta = PackageMetadataSchema.parse({
      version: 'unknown',
      internal: false,
      dependencies: [],
      devDependencies: [],
      consumers: [],
      isPrivate: false,
    });
    const dedupKey = computeArtifactDedupKey({
      project: opts.defaultProject,
      kind: 'package',
      name: ext,
      packageName: ext,
    });
    const artifact: ArchArtifactRow = ArchArtifactRowSchema.parse({
      id,
      kind: 'package',
      project: opts.defaultProject,
      name: ext,
      description: `External npm package ${ext} (referenced by ${countConsumers(internals, ext)} internal package(s)).`,
      packageName: ext,
      techSubDomains: inferTechSubDomainsForExternalPackage(ext),
      tags: ['external'],
      metadataJson: JSON.stringify(meta),
      source: 'package_scan',
      extractedAtCommit: opts.extractedAtCommit,
      embeddingModel: DEFAULT_EMBEDDING_MODEL,
      embeddingDim: DEFAULT_EMBEDDING_DIM,
      embeddingVersion: DEFAULT_EMBEDDING_VERSION,
      createdAt: opts.now,
      updatedAt: opts.now,
      dedupKey,
    });
    result.artifacts.push(artifact);
  }

  // Pass 5: emit depends_on edges.
  for (const consumer of internals) {
    const allDeps = {
      ...(consumer.pkg.dependencies ?? {}),
      ...(consumer.pkg.devDependencies ?? {}),
    };
    for (const depName of Object.keys(allDeps)) {
      const internalTarget = internalsByName.get(depName);
      const targetId = internalTarget?.artifactId ?? externalArtifactIds.get(depName);
      if (!targetId) continue;
      try {
        const edgeId = newId('edge');
        const edge: ArchEdgeRow = ArchEdgeRowSchema.parse({
          id: edgeId,
          fromId: consumer.artifactId,
          toId: targetId,
          relation: 'depends_on',
          weight: 1.0,
          metadataJson: JSON.stringify({
            kind: 'package_dependency',
            consumerName: consumer.pkg.name,
            targetName: depName,
            edgeDedupKey: computeEdgeDedupKey({
              fromId: consumer.artifactId,
              toId: targetId,
              relation: 'depends_on',
            }),
          }),
          source: 'package_scan',
          createdAt: opts.now,
          updatedAt: opts.now,
        });
        result.edges.push(edge);
      } catch (err) {
        result.warnings.push(`package-extractor edge ${consumer.pkg.name}→${depName}: ${(err as Error).message}`);
      }
    }
  }

  return result;
}

function countConsumers(internals: InternalEntry[], pkgName: string): number {
  let n = 0;
  for (const e of internals) {
    if ((e.pkg.dependencies ?? {})[pkgName] !== undefined) n++;
    if ((e.pkg.devDependencies ?? {})[pkgName] !== undefined) n++;
  }
  return n;
}

function inferTechSubDomainsForPackage(name: string, rel: string): string[] {
  const lower = (name + ' ' + rel).toLowerCase();
  const tags = new Set<string>();
  if (lower.includes('analytics')) tags.add('web-analytics');
  if (lower.includes('logger')) tags.add('observability');
  if (lower.includes('metrics')) tags.add('observability');
  if (lower.includes('tracing')) tags.add('observability');
  if (lower.includes('events')) tags.add('event-driven');
  if (lower.includes('secrets')) tags.add('secrets-management');
  if (lower.includes('feature-registry') || lower.includes('architecture-registry') || lower.includes('local-rag') || lower.includes('local-llm')) {
    tags.add('ml-ai');
  }
  if (lower.includes('cli')) tags.add('agent-runtime');
  if (lower.includes('config')) tags.add('infra');
  if (lower.includes('test-kit') || lower.includes('vitest')) tags.add('testing');
  if (lower.includes('errors')) tags.add('observability');
  if (lower.includes('seo')) tags.add('seo');
  if (lower.includes('classifier') || lower.includes('decomposer') || lower.includes('story-decomposer') || lower.includes('ticket-template') || lower.includes('dedup')) {
    tags.add('agent-runtime');
  }
  if (lower.includes('image') || lower.includes('content-engine') || lower.includes('cms')) tags.add('cms');
  if (lower.includes('cast-bridge')) tags.add('integrations');
  if (lower.includes('integrity-check')) tags.add('testing');
  if (lower.includes('llm-cache')) tags.add('caching');
  if (rel.startsWith('apps/')) tags.add('agent-runtime');
  if (rel.startsWith('packages/')) tags.add('design-system'); // best-effort default
  if (tags.size === 0) tags.add('backend');
  return Array.from(tags);
}

function inferTechSubDomainsForExternalPackage(name: string): string[] {
  const lower = name.toLowerCase();
  const tags = new Set<string>();
  if (lower === 'react' || lower === 'react-dom' || lower.startsWith('@radix-ui') || lower === 'next' || lower === 'tailwindcss') tags.add('frontend');
  if (lower === 'hono' || lower.startsWith('@hono')) tags.add('bff');
  if (lower === 'better-sqlite3' || lower === 'drizzle-orm' || lower === 'drizzle-kit' || lower === 'sqlite-vec') tags.add('database');
  if (lower === 'pino' || lower === 'opentelemetry' || lower.startsWith('@opentelemetry')) tags.add('observability');
  if (lower === 'zod' || lower === 'nanoid') tags.add('agent-runtime');
  if (lower === 'vitest' || lower === 'playwright') tags.add('testing');
  if (lower === 'ts-morph' || lower === '@swc/core') tags.add('agent-runtime');
  if (tags.size === 0) tags.add('backend');
  return Array.from(tags);
}

function relativize(repoRoot: string, abs: string): string {
  if (abs.startsWith(repoRoot)) {
    let rel = abs.slice(repoRoot.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
  return abs;
}
