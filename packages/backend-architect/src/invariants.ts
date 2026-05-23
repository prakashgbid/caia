/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates Backend's contributions so the
 * Reviewer's `invariants-registry.ts` (which doesn't exist yet — sibling
 * brief F2) can collect them at process boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'backend.apiEndpoints'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `backend.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the Backend package's own tests AND
 * inside the Reviewer's post-composition pass.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  /** Architect that contributed this invariant. */
  contributor: string;
  /** Other architects whose fields this invariant reads. */
  reads: readonly string[];
  /** Severity if the predicate returns false. */
  severity: InvariantSeverity;
  /** Operator-facing description for the Reviewer's audit log. */
  description: string;
  /**
   * The predicate. Receives the JSONB blob (flat-keyed
   * `architectureFields` view OR nested composed-architecture view).
   * Pure + synchronous.
   */
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

/**
 * Read a field from the architecture blob. Tries the flat dotted key
 * first (matches `architectureFields` shape), then falls back to walking
 * the nested object path (matches composed-architecture shape).
 */
function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function asArray(v: unknown): readonly unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function asObject(v: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Readonly<Record<string, unknown>>;
}

/**
 * Backend's contributed invariants. Listed in stable order.
 */
export const BACKEND_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'backend.apiEndpoints-nonempty',
    contributor: 'backend',
    reads: ['backend.apiEndpoints'],
    severity: 'fail',
    description:
      'Every Backend output must declare at least one entry in `apiEndpoints`. An empty list means the architect failed to project the ticket\'s API surface.',
    detect(arch): boolean {
      const endpoints = asArray(readField(arch, 'backend.apiEndpoints'));
      return endpoints !== null && endpoints.length > 0;
    }
  },
  {
    id: 'backend.framework-is-next',
    contributor: 'backend',
    reads: ['backend.framework'],
    severity: 'fail',
    description:
      'The locked stack mandates Next.js 15 App Router. Any framework decision other than Next.js is a hard violation.',
    detect(arch): boolean {
      const fw = asObject(readField(arch, 'backend.framework'));
      if (!fw) return false;
      return fw.name === 'next';
    }
  },
  {
    id: 'backend.serviceBoundaries-declared',
    contributor: 'backend',
    reads: ['backend.serviceBoundaries'],
    severity: 'fail',
    description:
      'Every Backend output must declare a `serviceBoundaries.style` (monolith-with-modules|microservices|hybrid). The API-Gateway Architect reads this to choose routing config.',
    detect(arch): boolean {
      const sb = asObject(readField(arch, 'backend.serviceBoundaries'));
      if (!sb) return false;
      const style = sb.style;
      return (
        style === 'monolith-with-modules' ||
        style === 'microservices' ||
        style === 'hybrid' ||
        style === 'monolith'
      );
    }
  },
  {
    id: 'backend.endpoint-enumeration-matches-api-endpoints',
    contributor: 'backend',
    reads: ['backend.apiEndpoints', 'backend.endpointEnumeration'],
    severity: 'fail',
    description:
      'Every entry in `apiEndpoints` must have a matching `route` entry in `endpointEnumeration` (formatted `METHOD /path`). Database Architect reads `endpointEnumeration` verbatim — drift breaks downstream.',
    detect(arch): boolean {
      const endpoints = asArray(readField(arch, 'backend.apiEndpoints'));
      const enumeration = asArray(readField(arch, 'backend.endpointEnumeration'));
      if (!endpoints || !enumeration) return false;
      const enumeratedRoutes = new Set<string>();
      for (const e of enumeration) {
        const obj = asObject(e);
        if (obj && typeof obj.route === 'string') enumeratedRoutes.add(obj.route);
      }
      for (const ep of endpoints) {
        const obj = asObject(ep);
        if (!obj) return false;
        const method = typeof obj.method === 'string' ? obj.method : null;
        const path = typeof obj.path === 'string' ? obj.path : null;
        if (!method || !path) return false;
        const route = `${method} ${path}`;
        if (!enumeratedRoutes.has(route)) return false;
      }
      return true;
    }
  },
  {
    id: 'backend.every-endpoint-has-response-schema',
    contributor: 'backend',
    reads: ['backend.apiEndpoints', 'backend.responseSchemas'],
    severity: 'fail',
    description:
      'Every endpoint must declare a `responseSchemaRef` that resolves in `responseSchemas`. Endpoints without typed responses break the OpenAPI export.',
    detect(arch): boolean {
      const endpoints = asArray(readField(arch, 'backend.apiEndpoints'));
      const schemas = asObject(readField(arch, 'backend.responseSchemas'));
      if (!endpoints || !schemas) return false;
      const knownRefs = new Set(Object.keys(schemas));
      for (const ep of endpoints) {
        const obj = asObject(ep);
        if (!obj) return false;
        const ref = obj.responseSchemaRef;
        if (typeof ref !== 'string' || !knownRefs.has(ref)) return false;
      }
      return true;
    }
  },
  {
    id: 'backend.request-schemas-resolve',
    contributor: 'backend',
    reads: ['backend.apiEndpoints', 'backend.requestSchemas'],
    severity: 'fail',
    description:
      'Every endpoint that declares `requestSchemaRef` must have a matching entry in `requestSchemas`. Dangling refs break Zod runtime validation.',
    detect(arch): boolean {
      const endpoints = asArray(readField(arch, 'backend.apiEndpoints'));
      const schemas = asObject(readField(arch, 'backend.requestSchemas'));
      if (!endpoints) return false;
      const knownRefs = new Set(schemas ? Object.keys(schemas) : []);
      for (const ep of endpoints) {
        const obj = asObject(ep);
        if (!obj) return false;
        const ref = obj.requestSchemaRef;
        if (ref === undefined || ref === null) continue;
        if (typeof ref !== 'string' || !knownRefs.has(ref)) return false;
      }
      return true;
    }
  },
  {
    id: 'backend.error-envelope-declared',
    contributor: 'backend',
    reads: ['backend.errorEnvelope'],
    severity: 'fail',
    description:
      'The Backend output must declare a canonical error envelope with at least `schema` + `mapping`. Per-endpoint error shapes are a hard violation of the locked stack.',
    detect(arch): boolean {
      const env = asObject(readField(arch, 'backend.errorEnvelope'));
      if (!env) return false;
      if (typeof env.schema !== 'string') return false;
      const mapping = asObject(env.mapping);
      if (!mapping) return false;
      return Object.keys(mapping).length > 0;
    }
  },
  {
    id: 'backend.auth-requirements-declared',
    contributor: 'backend',
    reads: ['backend.authRequirements'],
    severity: 'fail',
    description:
      'Backend output must declare an `authRequirements.default` entry with a recognised scheme (cloudflare-access|service-token|public|bearer).',
    detect(arch): boolean {
      const auth = asObject(readField(arch, 'backend.authRequirements'));
      if (!auth) return false;
      const def = asObject(auth.default);
      if (!def) return false;
      const scheme = def.scheme;
      return (
        scheme === 'cloudflare-access' ||
        scheme === 'service-token' ||
        scheme === 'public' ||
        scheme === 'bearer'
      );
    }
  },
  {
    id: 'backend.rate-limits-declared',
    contributor: 'backend',
    reads: ['backend.rateLimits'],
    severity: 'advisory',
    description:
      'Backend output should declare a `rateLimits.default` entry with `windowMs` + `max` + `scope`. Missing defaults force the API-Gateway Architect to invent values.',
    detect(arch): boolean {
      const rl = asObject(readField(arch, 'backend.rateLimits'));
      if (!rl) return false;
      const def = asObject(rl.default);
      if (!def) return false;
      return (
        typeof def.windowMs === 'number' &&
        typeof def.max === 'number' &&
        typeof def.scope === 'string'
      );
    }
  },
  {
    id: 'backend.data-access-tables-cover-endpoint-touchpoints',
    contributor: 'backend',
    reads: ['backend.apiEndpoints', 'backend.dataAccess'],
    severity: 'fail',
    description:
      'Every table referenced in `apiEndpoints` (`persistsTo`, `readsFrom`, `deletesFrom`) must appear in `dataAccess.tables`. Missing entries mean the Database Architect won\'t emit a table for it.',
    detect(arch): boolean {
      const endpoints = asArray(readField(arch, 'backend.apiEndpoints'));
      const da = asObject(readField(arch, 'backend.dataAccess'));
      if (!endpoints || !da) return false;
      const tables = asArray(da.tables);
      if (!tables) return false;
      const known = new Set<string>();
      for (const t of tables) if (typeof t === 'string') known.add(t);
      for (const ep of endpoints) {
        const obj = asObject(ep);
        if (!obj) return false;
        for (const key of ['persistsTo', 'readsFrom', 'deletesFrom'] as const) {
          const v = obj[key];
          if (typeof v === 'string' && !known.has(v)) return false;
        }
      }
      return true;
    }
  },
  {
    id: 'backend.endpoints-have-auth-and-rate-limit',
    contributor: 'backend',
    reads: ['backend.apiEndpoints'],
    severity: 'advisory',
    description:
      'Every endpoint should declare an `auth` value and a `rateLimit` value (even if those just reference the defaults). Missing entries make per-endpoint overrides ambiguous.',
    detect(arch): boolean {
      const endpoints = asArray(readField(arch, 'backend.apiEndpoints'));
      if (!endpoints) return false;
      for (const ep of endpoints) {
        const obj = asObject(ep);
        if (!obj) return false;
        if (typeof obj.auth !== 'string') return false;
        if (typeof obj.rateLimit !== 'string') return false;
      }
      return true;
    }
  }
];
