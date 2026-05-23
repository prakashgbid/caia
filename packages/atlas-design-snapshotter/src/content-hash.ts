/**
 * Content-hash helpers — the dedup spine.
 *
 * SHA-256 is the only algorithm — chosen because step5 §4 uses
 * `sha256:<hex>` prefixed strings in the `design_assets.content_hash`
 * column and because Node ships a streaming SHA-256 in the standard library
 * (`crypto`). No external deps.
 */

import { createHash } from 'node:crypto';

/** Returns `sha256:<hex>` to match step5 §4's stored format. */
export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Stable hash of a JSON-serialisable object. Used to fingerprint design
 *  payloads, design tokens, etc. Object keys are sorted so insertion-order
 *  changes don't move the hash.
 */
export function sha256Of(obj: unknown): string {
  const canonical = canonicalJsonStringify(obj);
  return sha256(Buffer.from(canonical, 'utf8'));
}

/**
 * Deterministic JSON serialiser. Sorts object keys recursively. Arrays are
 * preserved in source order (arrays carry meaning — sorting them would lose
 * information).
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}
