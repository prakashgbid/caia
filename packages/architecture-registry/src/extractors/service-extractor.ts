/**
 * @chiefaia/architecture-registry — service extractor (ARCH-002)
 *
 * Identifies CAIA Hono apps + worker services from `apps/<service>/` folder
 * conventions and surfaces them as `kind='service'` artifacts. The
 * extractor pairs with the API extractor: each service's `exposedApis`
 * metadata is populated by joining on file path.
 *
 * Heuristics:
 *   - Each top-level folder under `apps/` is one service.
 *   - The service's name = folder basename.
 *   - `appName` from package.json or first-arg of `new Hono()` if found.
 *   - `port` parsed from a default in `serve({ port: NNN })` if present.
 *   - `hasBackgroundLoop = true` if the service has a `pump.ts`,
 *     `worker.ts`, `loop.ts`, or pump-style filename.
 *
 * No deep dependency analysis — that's left to ARCH-003 (package scanner)
 * which produces the canonical `package` artifacts the service depends on.
 */

import { nanoid } from 'nanoid';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArchArtifactRowSchema,
  ServiceMetadataSchema,
  type ArchArtifactRow,
  type ServiceMetadata,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_VERSION,
} from '../schema';
import { computeArtifactDedupKey } from '../dedup-key';
import type { ExtractionResult, ExtractorOptions } from './ts-morph-types';

const PUMP_FILENAMES = ['pump.ts', 'worker.ts', 'loop.ts', 'poller.ts'];

interface ServiceCandidate {
  appName: string;
  folderRel: string;
  port?: number;
  hasBackgroundLoop: boolean;
  description: string;
  tags: string[];
}

function safeReadJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function findFileRecursively(dir: string, predicate: (name: string) => boolean): boolean {
  let stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (e === 'node_modules' || e === 'dist' || e === '.next') continue;
        stack.push(full);
      } else if (predicate(e)) {
        return true;
      }
    }
  }
  return false;
}

function inspectService(appsRoot: string, name: string): ServiceCandidate | undefined {
  const folder = join(appsRoot, name);
  if (!existsSync(folder)) return undefined;
  const pkgPath = join(folder, 'package.json');
  const pkg = safeReadJson(pkgPath);
  if (!pkg) return undefined;
  const appName = (pkg.name as string) ?? name;
  const description = (pkg.description as string) ?? `Service '${name}' under apps/${name}/`;

  // Port detection: read the entry file referenced by package.json's `main` /
  // `start` script, or fall back to common entry locations.
  const port = detectPort(folder, pkg);
  const hasBackgroundLoop = findFileRecursively(folder, (n) => PUMP_FILENAMES.includes(n));

  const tags: string[] = [];
  if (pkg.private) tags.push('private');
  if (Object.keys((pkg.dependencies as object) ?? {}).includes('hono')) tags.push('hono');
  if (Object.keys((pkg.dependencies as object) ?? {}).includes('next')) tags.push('next');

  return {
    appName,
    folderRel: `apps/${name}`,
    port,
    hasBackgroundLoop,
    description,
    tags,
  };
}

const PORT_RE = /\bport\s*[:=]\s*(\d{3,5})\b/i;
const SERVE_PORT_RE = /serve\(\s*\{[^}]*port\s*:\s*(\d{3,5})/i;

function detectPort(folder: string, _pkg: Record<string, unknown>): number | undefined {
  const candidates = [
    join(folder, 'src/index.ts'),
    join(folder, 'src/main.ts'),
    join(folder, 'src/server.ts'),
    join(folder, 'src/start.ts'),
  ];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      const text = readFileSync(c, 'utf8');
      const m = SERVE_PORT_RE.exec(text) ?? PORT_RE.exec(text);
      if (m && m[1]) {
        const port = Number(m[1]);
        if (port > 0 && port < 65536) return port;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * Public extractor: walks `<repoRoot>/apps/*` and emits `kind='service'`
 * artifacts.
 */
export function extractServicesFromAppsRoot(opts: ExtractorOptions): ExtractionResult {
  const result: ExtractionResult = { artifacts: [], edges: [], warnings: [] };
  const newId = opts.newId ?? ((p) => `${p}_${nanoid(12)}`);
  const appsRoot = join(opts.repoRoot, 'apps');
  if (!existsSync(appsRoot)) {
    result.warnings.push(`service-extractor: ${appsRoot} not found; skipped`);
    return result;
  }

  let entries: string[];
  try {
    entries = readdirSync(appsRoot);
  } catch (err) {
    result.warnings.push(`service-extractor: cannot list apps/ → ${(err as Error).message}`);
    return result;
  }

  for (const name of entries) {
    try {
      const cand = inspectService(appsRoot, name);
      if (!cand) continue;

      const meta: ServiceMetadata = ServiceMetadataSchema.parse({
        appName: cand.appName,
        ...(cand.port ? { port: cand.port } : {}),
        exposedApis: [], // resolved later when API extractor results are joined
        persistsToSchemas: [],
        emitsEvents: [],
        hasBackgroundLoop: cand.hasBackgroundLoop,
      });

      const id = newId('arch');
      const dedupKey = computeArtifactDedupKey({
        project: opts.defaultProject,
        kind: 'service',
        name: cand.appName,
        entryPath: cand.folderRel,
      });

      const techSubDomains = inferTechSubDomainsForService(name, cand);

      const artifact: ArchArtifactRow = ArchArtifactRowSchema.parse({
        id,
        kind: 'service',
        project: opts.defaultProject,
        name: cand.appName,
        description: cand.description,
        keySignature: undefined,
        filePaths: [cand.folderRel],
        entryPath: cand.folderRel,
        owningService: cand.appName,
        techSubDomains,
        tags: cand.tags,
        metadataJson: JSON.stringify(meta),
        source: 'ast_extract',
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
      result.warnings.push(`service-extractor: apps/${name} → ${(err as Error).message}`);
    }
  }

  return result;
}

function inferTechSubDomainsForService(folderName: string, cand: ServiceCandidate): string[] {
  const tags = new Set<string>();
  if (folderName.includes('dashboard')) tags.add('frontend');
  if (folderName.includes('orchestrator') || folderName.includes('executor') || folderName.includes('poller')) {
    tags.add('agent-runtime');
    tags.add('event-driven');
  }
  if (cand.tags.includes('hono')) tags.add('bff');
  if (cand.tags.includes('next')) tags.add('frontend');
  if (folderName.includes('backup') || folderName.includes('pulse')) tags.add('observability');
  if (folderName.includes('pulse') || folderName.includes('sentinel')) tags.add('monitoring-alerting');
  if (tags.size === 0) tags.add('backend');
  return Array.from(tags);
}
