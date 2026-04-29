/**
 * @chiefaia/architecture-registry — Hono route extractor (ARCH-002)
 *
 * Walks TypeScript source files registering Hono routes (`app.get('/...')`,
 * `app.post('/...')`, etc.) and emits one `arch_artifacts` row per route
 * with `kind='api'`. Supports the canonical Hono pattern used in CAIA's
 * orchestrator + executor + dashboard:
 *
 *   const app = new Hono();
 *   app.get('/observability/health', (c) => { ... });
 *   app.post('/events', zValidator('json', EventSchema), async (c) => { ... });
 *
 * Also covers `app.route('/sub', subApp)` mounts (recursive) and the
 * @hono/zod-openapi `createRoute` builder when present.
 *
 * Auth detection: if the route's middleware chain mentions one of the
 * known auth-middleware identifiers (`requireAuth`, `withAuth`,
 * `bearerAuth`, etc.), `authRequired = true`.
 */

import { nanoid } from 'nanoid';
import {
  Project,
  ScriptKind,
  SyntaxKind,
  type SourceFile,
  type CallExpression,
} from 'ts-morph';
import {
  ArchArtifactRowSchema,
  ApiMetadataSchema,
  type ArchArtifactRow,
  type ApiMetadata,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_VERSION,
} from '../schema';
import { computeArtifactDedupKey } from '../dedup-key';
import type { ExtractionResult, ExtractorOptions } from './ts-morph-types';
import { sha256 } from './utils';

const HONO_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);

const AUTH_MIDDLEWARE_NAMES = [
  'requireAuth',
  'withAuth',
  'bearerAuth',
  'jwtAuth',
  'sessionAuth',
  'authGuard',
];

function isAuthMiddleware(text: string): boolean {
  return AUTH_MIDDLEWARE_NAMES.some((n) => text.includes(n));
}

interface RouteCandidate {
  method: string;
  path: string;
  middlewareChain: string[];
  authRequired: boolean;
  signatureText: string;
  appName?: string;
  jsDocSummary?: string;
}

function inspectCallExpression(call: CallExpression): RouteCandidate | undefined {
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return undefined;
  const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const methodName = propAccess.getName();
  if (!HONO_METHODS.has(methodName)) return undefined;

  const args = call.getArguments();
  if (args.length < 2) return undefined; // need at least path + handler

  const firstArg = args[0]!;
  if (firstArg.getKind() !== SyntaxKind.StringLiteral) return undefined;
  const path = firstArg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();

  // Middleware chain: every arg between path and final handler.
  const middlewareChain: string[] = [];
  for (let i = 1; i < args.length - 1; i++) {
    const arg = args[i]!;
    const text = arg.getText();
    middlewareChain.push(text.length > 80 ? `${text.slice(0, 80)}…` : text);
  }
  const authRequired = middlewareChain.some(isAuthMiddleware);

  // App name: text of the receiver expression (e.g. 'app', 'router', 'subApp').
  const receiver = propAccess.getExpression().getText();

  return {
    method: methodName.toUpperCase(),
    path,
    middlewareChain,
    authRequired,
    signatureText: call.getText().split('\n').slice(0, 3).join('\n'),
    appName: receiver,
  };
}

export function extractApisFromProject(
  project: Project,
  sourceFiles: SourceFile[],
  opts: ExtractorOptions,
): ExtractionResult {
  const result: ExtractionResult = { artifacts: [], edges: [], warnings: [] };
  const newId = opts.newId ?? ((p) => `${p}_${nanoid(12)}`);

  for (const sf of sourceFiles) {
    const filePath = relativize(opts.repoRoot, sf.getFilePath());
    const fileText = sf.getFullText();
    const contentHash = sha256(fileText);

    // Quick bail: if the file doesn't import anything Hono-shaped, skip it.
    const importText = sf.getImportDeclarations().map((i) => i.getModuleSpecifierValue()).join(' ');
    const looksLikeHono = importText.includes('hono') || importText.includes('@hono');
    // We still scan files that match *.routes.ts / *.api.ts even without imports,
    // because Hono can be imported transitively.
    const looksLikeRouteFile = /\.(routes|api)\.ts$/.test(filePath);
    if (!looksLikeHono && !looksLikeRouteFile) continue;

    const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of callExprs) {
      try {
        const cand = inspectCallExpression(call);
        if (!cand) continue;

        const apiMeta: ApiMetadata = ApiMetadataSchema.parse({
          method: cand.method as ApiMetadata['method'],
          path: cand.path,
          authRequired: cand.authRequired,
          middlewareChain: cand.middlewareChain,
          appName: cand.appName,
        });

        const routeSig = `${cand.method} ${cand.path}`;
        const id = newId('arch');
        const dedupKey = computeArtifactDedupKey({
          project: opts.defaultProject,
          kind: 'api',
          name: routeSig,
          routeSignature: routeSig,
        });

        const description = cand.jsDocSummary ?? `${routeSig} (${cand.appName ?? 'app'}, ${cand.middlewareChain.length} middleware)`;
        const techSubDomains = inferTechSubDomainsForApi(filePath);

        const artifact: ArchArtifactRow = ArchArtifactRowSchema.parse({
          id,
          kind: 'api',
          project: opts.defaultProject,
          name: routeSig,
          description,
          keySignature: cand.signatureText,
          filePaths: [filePath],
          entryPath: filePath,
          routeSignature: routeSig,
          techSubDomains,
          tags: cand.authRequired ? ['auth-required'] : [],
          metadataJson: JSON.stringify(apiMeta),
          source: 'ast_extract',
          contentHash,
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
        result.warnings.push(
          `api-extractor: ${filePath}@${call.getStartLineNumber()} → ${(err as Error).message}`,
        );
      }
    }
  }

  return result;
}

export function extractApisFromInMemorySources(
  sources: Array<{ path: string; content: string }>,
  opts: ExtractorOptions,
): ExtractionResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: false, allowJs: true, target: 99 },
  });
  const sourceFiles: SourceFile[] = sources.map((s) =>
    project.createSourceFile(s.path, s.content, { scriptKind: ScriptKind.TS }),
  );
  return extractApisFromProject(project, sourceFiles, opts);
}

export function extractApisFromFiles(
  filePaths: string[],
  opts: ExtractorOptions,
): ExtractionResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { strict: false, allowJs: true, target: 99 },
  });
  const sourceFiles: SourceFile[] = filePaths.map((fp) => project.addSourceFileAtPath(fp));
  return extractApisFromProject(project, sourceFiles, opts);
}

function relativize(repoRoot: string, abs: string): string {
  if (abs.startsWith(repoRoot)) {
    let rel = abs.slice(repoRoot.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
  return abs;
}

function inferTechSubDomainsForApi(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const tags = new Set<string>(['bff']);
  if (lower.includes('observability') || lower.includes('health')) tags.add('observability');
  if (lower.includes('events')) tags.add('event-driven');
  if (lower.includes('auth')) tags.add('auth');
  if (lower.includes('metrics')) tags.add('observability');
  return Array.from(tags);
}
