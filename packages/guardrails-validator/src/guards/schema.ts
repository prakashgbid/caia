/**
 * Schema guard — opt-in zod schema validation.
 *
 * Caller passes a zod schema; output is parsed via `safeParse`. On failure,
 * action = reject and the flag carries the zod issue path-list.
 */

import type { ZodTypeAny } from 'zod';

export interface SchemaScanResult {
  ok: boolean;
  /** Issues, each as a `path.to.field: code (message)` string. */
  issues: string[];
  /** Parsed value if ok, else null. */
  value: unknown;
}

export function scanSchema(payload: string, schema: ZodTypeAny): SchemaScanResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    return {
      ok: false,
      issues: [`<root>: invalid_json (${(err as Error).message})`],
      value: null,
    };
  }
  const result = schema.safeParse(parsed);
  if (result.success) {
    return { ok: true, issues: [], value: result.data };
  }
  const issues = result.error.issues.map((i) => {
    const path = i.path.length === 0 ? '<root>' : i.path.join('.');
    return `${path}: ${i.code} (${i.message})`;
  });
  return { ok: false, issues, value: null };
}
