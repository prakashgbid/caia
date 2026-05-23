/**
 * Content-hash utilities — SHA-256, prefixed with `sha256:` so the
 * value is self-describing in storage and logs.
 *
 * Used for:
 *   - Asset blob dedup (design_assets.content_hash).
 *   - Whole-payload hashing (design_versions.rendered_design_hash) so
 *     "no-op re-uploads" can be detected by callers if they care.
 */

import { createHash } from 'node:crypto';

/** Hash an in-memory Buffer or string. Returns `sha256:<hex>`. */
export function sha256(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

/**
 * Canonical JSON stringification (stable key order, no whitespace) — the
 * hash inputs MUST be deterministic across machines and Node versions or
 * dedup breaks. `JSON.stringify` order is insertion-order, not lex-order,
 * so we sort keys recursively.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortValue);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortValue(obj[k]);
  }
  return out;
}

/** Hash an arbitrary value via canonical JSON. */
export function hashValue(value: unknown): string {
  return sha256(canonicalJson(value));
}
