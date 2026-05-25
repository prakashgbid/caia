/**
 * `@caia/full-stack-engineer/spec-reader` — consolidate architects'
 * outputs + Test Author's test cases into a focused ImplementationBrief.
 *
 * `ticket.architecture` is the disjoint JSONB blob composed by the 17
 * specialist architects. Each architect owns a set of dotted JSON paths
 * declared in their `ArchitectSectionContract` (see `@caia/architect-kit`).
 * The blob's top-level keys mirror the canonical architect families:
 *
 *   - frontend.*       (component tree, tokens, routes, state modules)
 *   - backend.*        (endpoints, services, auth constraints)
 *   - database.*       (migrations, repositories)
 *   - accessibility.*  (a11y constraints)
 *   - performance.*    (perf budgets)
 *   - observability.*  (metrics, tracing, logging hooks)
 *   - security.*       (authz, secrets, threat model)
 *   - i18n.*           (locales, dictionaries)
 *   - seo.*            (titles, descriptions, OG tags)
 *
 * Anything that doesn't fit one of these buckets is preserved as a
 * `miscArchitectNotes` entry so the subagent can still see it.
 *
 * This is a pure function; no I/O, no side-effects. Determinism is
 * critical because the subagent prompt is hashed for caching.
 */

import type { ArchitectOutput } from '@caia/architect-kit';

import type {
  BackendBriefSection,
  ComponentSpec,
  CrosscuttingBriefSection,
  DatabaseBriefSection,
  EndpointSpec,
  FrontendBriefSection,
  ImplementationBrief,
  LoadedTicket,
  MigrationSpec,
  RepositorySpec,
  RouteSpec,
  ServiceSpec,
  StackLockBlock,
  StateModuleSpec,
  TestsBriefSection,
} from './types.js';

/** Stack-lock block — emitted into every brief verbatim. */
export const SHADCN_STACK_LOCK: StackLockBlock = Object.freeze({
  shadcnReactFirst: true,
  uiPrimitives: 'shadcn/ui',
  styling: 'tailwind',
  forbidden: Object.freeze([
    '@mui/*',
    '@emotion/*',
    'styled-components',
    '@chakra-ui/*',
    'antd',
    'bootstrap',
  ]),
});

/**
 * Pure: read the loaded ticket and produce a focused implementation
 * brief. The brief is the single input handed to `code-emitter.ts`.
 */
export function readSpec(loaded: LoadedTicket): ImplementationBrief {
  const arch = loaded.architecture ?? {};

  return {
    ticketId: loaded.ticketId,
    projectId: loaded.projectId,
    ticketTitle: pickTitle(loaded),
    acceptanceCriteria: [...loaded.acceptanceCriteria],
    frontend: readFrontend(arch),
    backend: readBackend(arch),
    database: readDatabase(arch),
    tests: readTests(loaded),
    crosscutting: readCrosscutting(arch),
    stackLock: SHADCN_STACK_LOCK,
    miscArchitectNotes: readMiscNotes(loaded.architectOutputs),
  };
}

// ─── Section readers ──────────────────────────────────────────────────────

function readFrontend(arch: Record<string, unknown>): FrontendBriefSection {
  const fe = asRecord(arch['frontend']);
  return {
    componentTree: asComponentTree(fe['componentTree']),
    tokens: asRecordOrUndefined(fe['tokens']),
    routes: asRoutes(fe['routes']),
    stateModules: asStateModules(fe['stateModules']),
  };
}

function readBackend(arch: Record<string, unknown>): BackendBriefSection {
  const be = asRecord(arch['backend']);
  const sec = asRecord(arch['security']);
  return {
    endpoints: asEndpoints(be['endpoints']),
    services: asServices(be['services']),
    authConstraints: dedupeStrings([
      ...asStringArray(be['authConstraints']),
      ...asStringArray(sec['authz']),
    ]),
  };
}

function readDatabase(arch: Record<string, unknown>): DatabaseBriefSection {
  const db = asRecord(arch['database']);
  return {
    migrations: asMigrations(db['migrations']),
    repositories: asRepositories(db['repositories']),
  };
}

function readCrosscutting(arch: Record<string, unknown>): CrosscuttingBriefSection {
  return {
    accessibility: asStringArray(asRecord(arch['accessibility'])['constraints']),
    performanceBudgets: asStringArray(asRecord(arch['performance'])['budgets']),
    observability: asStringArray(asRecord(arch['observability'])['hooks']),
    security: asStringArray(asRecord(arch['security'])['constraints']),
    i18n: asStringArray(asRecord(arch['i18n'])['constraints']),
    seo: asStringArray(asRecord(arch['seo'])['constraints']),
  };
}

function readTests(loaded: LoadedTicket): TestsBriefSection {
  return {
    cases: [...loaded.testCases],
    localGate: {
      typecheck: true,
      lint: true,
      vitest: loaded.testCases.some((c) => c.layer === 'unit' || c.layer === 'integration'),
    },
  };
}

function readMiscNotes(
  outputs: readonly ArchitectOutput[] | undefined,
): ImplementationBrief['miscArchitectNotes'] {
  if (!outputs || outputs.length === 0) return [];
  const out: { architect: string; note: string }[] = [];
  for (const o of outputs) {
    if (o.notes && o.notes.trim().length > 0) {
      out.push({ architect: o.architectName, note: o.notes.trim() });
    }
  }
  return out;
}

// ─── Coercion helpers ─────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asRecordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function dedupeStrings(input: readonly string[]): readonly string[] {
  return [...new Set(input)];
}

function asComponentTree(value: unknown): readonly ComponentSpec[] {
  if (!Array.isArray(value)) return [];
  const out: ComponentSpec[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const path = typeof r['path'] === 'string' ? r['path'] : '';
    const componentName = typeof r['componentName'] === 'string' ? r['componentName'] : '';
    if (!path || !componentName) continue;
    out.push({
      path,
      componentName,
      shadcnPrimitives: asStringArray(r['shadcnPrimitives']),
      anchors: asStringArray(r['anchors']),
      notes: typeof r['notes'] === 'string' ? r['notes'] : '',
    });
  }
  return out;
}

function asRoutes(value: unknown): readonly RouteSpec[] {
  if (!Array.isArray(value)) return [];
  const out: RouteSpec[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const path = typeof r['path'] === 'string' ? r['path'] : '';
    const rendersComponent =
      typeof r['rendersComponent'] === 'string' ? r['rendersComponent'] : '';
    if (!path || !rendersComponent) continue;
    const route: RouteSpec = { path, rendersComponent };
    if (typeof r['layoutClass'] === 'string') route.layoutClass = r['layoutClass'];
    if (typeof r['serverComponent'] === 'boolean') route.serverComponent = r['serverComponent'];
    out.push(route);
  }
  return out;
}

function asStateModules(value: unknown): readonly StateModuleSpec[] {
  if (!Array.isArray(value)) return [];
  const out: StateModuleSpec[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const path = typeof r['path'] === 'string' ? r['path'] : '';
    const storeName = typeof r['storeName'] === 'string' ? r['storeName'] : '';
    if (!path || !storeName) continue;
    out.push({
      path,
      storeName,
      sliceKeys: asStringArray(r['sliceKeys']),
    });
  }
  return out;
}

function asEndpoints(value: unknown): readonly EndpointSpec[] {
  if (!Array.isArray(value)) return [];
  const out: EndpointSpec[] = [];
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  for (const item of value) {
    const r = asRecord(item);
    const method = typeof r['method'] === 'string' ? r['method'].toUpperCase() : '';
    const path = typeof r['path'] === 'string' ? r['path'] : '';
    const handlerPath = typeof r['handlerPath'] === 'string' ? r['handlerPath'] : '';
    if (!allowedMethods.has(method) || !path || !handlerPath) continue;
    out.push({
      method: method as EndpointSpec['method'],
      path,
      handlerPath,
      requestShape: typeof r['requestShape'] === 'string' ? r['requestShape'] : 'unknown',
      responseShape: typeof r['responseShape'] === 'string' ? r['responseShape'] : 'unknown',
      notes: typeof r['notes'] === 'string' ? r['notes'] : '',
    });
  }
  return out;
}

function asServices(value: unknown): readonly ServiceSpec[] {
  if (!Array.isArray(value)) return [];
  const out: ServiceSpec[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const path = typeof r['path'] === 'string' ? r['path'] : '';
    const serviceName = typeof r['serviceName'] === 'string' ? r['serviceName'] : '';
    if (!path || !serviceName) continue;
    out.push({
      path,
      serviceName,
      notes: typeof r['notes'] === 'string' ? r['notes'] : '',
    });
  }
  return out;
}

function asMigrations(value: unknown): readonly MigrationSpec[] {
  if (!Array.isArray(value)) return [];
  const out: MigrationSpec[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const filename = typeof r['filename'] === 'string' ? r['filename'] : '';
    const sql = typeof r['sql'] === 'string' ? r['sql'] : '';
    if (!filename || !sql) continue;
    out.push({
      filename,
      sql,
      notes: typeof r['notes'] === 'string' ? r['notes'] : '',
    });
  }
  return out;
}

function asRepositories(value: unknown): readonly RepositorySpec[] {
  if (!Array.isArray(value)) return [];
  const out: RepositorySpec[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const path = typeof r['path'] === 'string' ? r['path'] : '';
    const repoName = typeof r['repoName'] === 'string' ? r['repoName'] : '';
    if (!path || !repoName) continue;
    out.push({
      path,
      repoName,
      notes: typeof r['notes'] === 'string' ? r['notes'] : '',
    });
  }
  return out;
}

function pickTitle(loaded: LoadedTicket): string {
  const t = loaded.ticket;
  if (typeof t['title'] === 'string' && t['title'].length > 0) return t['title'];
  if (typeof t['displayName'] === 'string' && t['displayName'].length > 0) {
    return t['displayName'];
  }
  return loaded.ticketId;
}

// ─── Stack-lock guard ─────────────────────────────────────────────────────

/**
 * Check that emitted file contents don't violate the shadcn/Tailwind
 * stack lock. Returns the list of violations (empty when compliant).
 *
 * Frontend files only — backend / database / non-tsx are exempt.
 * Test files are exempt because they may import from `@testing-library` etc.
 */
export function findStackLockViolations(
  files: readonly { path: string; contents: string }[],
): readonly { path: string; violation: string }[] {
  const out: { path: string; violation: string }[] = [];
  for (const f of files) {
    if (!/\.(tsx|jsx|ts|js)$/i.test(f.path)) continue;
    if (/\.(test|spec)\.(t|j)sx?$/i.test(f.path)) continue;
    for (const pattern of SHADCN_STACK_LOCK.forbidden) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^"\']+');
      const re = new RegExp(`from ['"]${escaped}['"]`);
      if (re.test(f.contents)) {
        out.push({ path: f.path, violation: `forbidden import: ${pattern}` });
      }
    }
  }
  return out;
}
