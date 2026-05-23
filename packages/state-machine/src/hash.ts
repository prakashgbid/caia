import { createHash } from 'node:crypto';

/**
 * Canonical-JSON sha256, used as the idempotency key for `state_history`.
 *
 * Stable key order - keys are sorted alphabetically at every depth. This
 * means {a:1,b:2} and {b:2,a:1} hash identically. Arrays preserve order.
 */
export function hashPayload(payload: Record<string, unknown>): string {
  const canonical = stableStringify(payload);
  return createHash('sha256').update(canonical).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ':' + stableStringify(obj[k]),
    );
    return '{' + parts.join(',') + '}';
  }
  // undefined, function, etc. -> null per JSON semantics
  return 'null';
}
