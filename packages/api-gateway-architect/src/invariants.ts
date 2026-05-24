/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

import {
  ALLOWED_AUTH_TYPES,
  ALLOWED_VERSIONING_KINDS,
  REQUIRED_GATEWAY_CODES,
  REQUIRED_QUOTA_TIERS
} from './contract.js';

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  contributor: string;
  reads: readonly string[];
  severity: InvariantSeverity;
  description: string;
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    // Defence in depth: refuse to traverse into prototype-chain keys.
    if (UNSAFE_KEYS.has(part)) return undefined;
    cursor = Object.prototype.hasOwnProperty.call(cursor, part)
      ? (cursor as Record<string, unknown>)[part]
      : undefined;
  }
  return cursor;
}

function asObject(v: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Readonly<Record<string, unknown>>;
}

function asArray(v: unknown): readonly unknown[] | null {
  return Array.isArray(v) ? v : null;
}

export const API_GATEWAY_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'apiGateway.error-envelope-covers-required-codes',
    contributor: 'apiGateway',
    reads: ['apiGateway.errorEnvelope'],
    severity: 'fail',
    description:
      'errorEnvelope.mapping MUST surface every required gateway code (GATEWAY_RATE_LIMITED, GATEWAY_AUTH_FAILED, GATEWAY_UPSTREAM_TIMEOUT, GATEWAY_UPSTREAM_UNAVAILABLE, GATEWAY_BAD_REQUEST). Observability + frontend retry rely on these names.',
    detect(arch): boolean {
      const env = asObject(readField(arch, 'apiGateway.errorEnvelope'));
      if (!env) return false;
      const mapping = asObject(env.mapping);
      if (!mapping) return false;
      const seenCodes = new Set<string>();
      for (const [, entry] of Object.entries(mapping)) {
        const e = asObject(entry);
        if (!e) continue;
        if (typeof e.gatewayCode === 'string') seenCodes.add(e.gatewayCode as string);
      }
      return REQUIRED_GATEWAY_CODES.every(c => seenCodes.has(c));
    }
  },
  {
    id: 'apiGateway.cors-wildcard-credentials-forbidden',
    contributor: 'apiGateway',
    reads: ['apiGateway.corsPolicy'],
    severity: 'fail',
    description:
      'CORS policy with `allowedOrigins: ["*"]` AND `allowCredentials: true` is rejected by every modern browser; emitting it is a bug.',
    detect(arch): boolean {
      const cors = asObject(readField(arch, 'apiGateway.corsPolicy'));
      if (!cors) return false;
      const candidates: Readonly<Record<string, unknown>>[] = [];
      const def = asObject(cors.default);
      if (def) candidates.push(def);
      const perTenant = asObject(cors.perTenant);
      if (perTenant) {
        for (const [, v] of Object.entries(perTenant)) {
          const inner = asObject(v);
          if (inner) candidates.push(inner);
        }
      }
      for (const c of candidates) {
        const origins = asArray(c.allowedOrigins);
        if (!origins) continue;
        const hasWildcard = origins.some(o => o === '*');
        if (hasWildcard && c.allowCredentials === true) return false;
      }
      return true;
    }
  },
  {
    id: 'apiGateway.versioning-kind-allowed',
    contributor: 'apiGateway',
    reads: ['apiGateway.versioningStrategy'],
    severity: 'fail',
    description: `versioningStrategy.kind MUST be one of ${ALLOWED_VERSIONING_KINDS.join(' | ')}.`,
    detect(arch): boolean {
      const vs = asObject(readField(arch, 'apiGateway.versioningStrategy'));
      if (!vs) return false;
      return typeof vs.kind === 'string' && ALLOWED_VERSIONING_KINDS.includes(vs.kind as string);
    }
  },
  {
    id: 'apiGateway.versioning-sunset-window',
    contributor: 'apiGateway',
    reads: ['apiGateway.versioningStrategy'],
    severity: 'fail',
    description:
      'versioningStrategy.sunsetPolicy.advanceNoticeDays MUST be >= 180 days (locked operator policy).',
    detect(arch): boolean {
      const vs = asObject(readField(arch, 'apiGateway.versioningStrategy'));
      if (!vs) return false;
      const sp = asObject(vs.sunsetPolicy);
      if (!sp) return false;
      return typeof sp.advanceNoticeDays === 'number' && (sp.advanceNoticeDays as number) >= 180;
    }
  },
  {
    id: 'apiGateway.transforms-inject-request-id',
    contributor: 'apiGateway',
    reads: ['apiGateway.requestResponseTransforms'],
    severity: 'fail',
    description:
      'requestResponseTransforms.request MUST contain an inject-header op for X-Request-Id (case-insensitive).',
    detect(arch): boolean {
      const t = asObject(readField(arch, 'apiGateway.requestResponseTransforms'));
      if (!t) return false;
      const reqOps = asArray(t.request);
      if (!reqOps) return false;
      for (const raw of reqOps) {
        const op = asObject(raw);
        if (!op) continue;
        if (op.op === 'inject-header' && typeof op.header === 'string') {
          if ((op.header as string).toLowerCase() === 'x-request-id') return true;
        }
      }
      return false;
    }
  },
  {
    id: 'apiGateway.transforms-strip-server-fingerprint',
    contributor: 'apiGateway',
    reads: ['apiGateway.requestResponseTransforms'],
    severity: 'fail',
    description:
      'requestResponseTransforms.response MUST strip both `Server` and `X-Powered-By` response headers.',
    detect(arch): boolean {
      const t = asObject(readField(arch, 'apiGateway.requestResponseTransforms'));
      if (!t) return false;
      const respOps = asArray(t.response);
      if (!respOps) return false;
      const stripped = new Set<string>();
      for (const raw of respOps) {
        const op = asObject(raw);
        if (!op) continue;
        if (op.op === 'strip-header' && typeof op.header === 'string') {
          stripped.add((op.header as string).toLowerCase());
        }
      }
      return stripped.has('server') && stripped.has('x-powered-by');
    }
  },
  {
    id: 'apiGateway.quotas-cover-required-tiers',
    contributor: 'apiGateway',
    reads: ['apiGateway.apiQuotas'],
    severity: 'fail',
    description: `apiQuotas.perTier MUST include every required tier: ${REQUIRED_QUOTA_TIERS.join(', ')}.`,
    detect(arch): boolean {
      const q = asObject(readField(arch, 'apiGateway.apiQuotas'));
      if (!q) return false;
      const perTier = asObject(q.perTier);
      if (!perTier) return false;
      return REQUIRED_QUOTA_TIERS.every(t => t in perTier);
    }
  },
  {
    id: 'apiGateway.free-tier-rejects-overage',
    contributor: 'apiGateway',
    reads: ['apiGateway.apiQuotas'],
    severity: 'fail',
    description:
      'Free tier MUST reject on quota overage (otherwise the free tier is an unbounded cost surface).',
    detect(arch): boolean {
      const q = asObject(readField(arch, 'apiGateway.apiQuotas'));
      if (!q) return false;
      const perTier = asObject(q.perTier);
      if (!perTier) return false;
      const free = asObject(perTier.free);
      if (!free) return false;
      return free.overage === 'reject';
    }
  },
  {
    id: 'apiGateway.auth-gates-types-allowed',
    contributor: 'apiGateway',
    reads: ['apiGateway.authGates'],
    severity: 'fail',
    description: `Every authGates entry MUST use a recognised authType: ${ALLOWED_AUTH_TYPES.join(' | ')}.`,
    detect(arch): boolean {
      const gates = readField(arch, 'apiGateway.authGates');
      if (Array.isArray(gates)) {
        for (const raw of gates) {
          const g = asObject(raw);
          if (!g) return false;
          if (!ALLOWED_AUTH_TYPES.includes(g.authType as string)) return false;
        }
        return gates.length > 0;
      }
      const gateObj = asObject(gates);
      if (!gateObj) return false;
      const entries = Object.entries(gateObj);
      if (entries.length === 0) return false;
      for (const [, raw] of entries) {
        const g = asObject(raw);
        if (!g) return false;
        if (!ALLOWED_AUTH_TYPES.includes(g.authType as string)) return false;
      }
      return true;
    }
  },
  {
    id: 'apiGateway.webhook-signing-strong-algorithm',
    contributor: 'apiGateway',
    reads: ['apiGateway.webhookSecrets'],
    severity: 'fail',
    description:
      'Webhook signing MUST use HMAC-SHA256 (or stronger). Weaker algorithms (MD5, SHA1) are rejected.',
    detect(arch): boolean {
      const w = asObject(readField(arch, 'apiGateway.webhookSecrets'));
      if (!w) return false;
      const signing = asObject(w.signing);
      if (!signing) return false;
      const alg = typeof signing.algorithm === 'string' ? (signing.algorithm as string).toUpperCase() : '';
      if (alg === 'HMAC-SHA256' || alg === 'HMAC-SHA384' || alg === 'HMAC-SHA512') return true;
      return false;
    }
  },
  {
    id: 'apiGateway.webhook-timestamp-tolerance-bounded',
    contributor: 'apiGateway',
    reads: ['apiGateway.webhookSecrets'],
    severity: 'fail',
    description:
      'Webhook signing timestampToleranceSec MUST be > 0 and <= 300 (replay-attack window).',
    detect(arch): boolean {
      const w = asObject(readField(arch, 'apiGateway.webhookSecrets'));
      if (!w) return false;
      const signing = asObject(w.signing);
      if (!signing) return false;
      const t = signing.timestampToleranceSec;
      return typeof t === 'number' && (t as number) > 0 && (t as number) <= 300;
    }
  },
  {
    id: 'apiGateway.rate-limits-perRoute-present',
    contributor: 'apiGateway',
    reads: ['apiGateway.rateLimits'],
    severity: 'fail',
    description:
      'rateLimits MUST declare a perRoute map (even if empty) AND either a perTenant map or defaults block.',
    detect(arch): boolean {
      const rl = asObject(readField(arch, 'apiGateway.rateLimits'));
      if (!rl) return false;
      const perRoute = asObject(rl.perRoute);
      if (!perRoute) return false;
      const perTenant = asObject(rl.perTenant);
      const defaults = asObject(rl.defaults);
      return perTenant !== null || defaults !== null;
    }
  }
];
