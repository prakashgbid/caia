/**
 * Revision helpers — RFC-8785 JCS-style canonical JSON for deterministic
 * sha256 hashing of business plans.
 */

import { createHash } from 'node:crypto';

import type { BusinessPlanV2 } from './types/proposal.js';

/**
 * Canonical JSON per RFC 8785 (JCS): object keys sorted lexicographically,
 * UTF-16-code-point comparison, recursive. Arrays preserve order.
 *
 * Trade-off: we use JSON.stringify on the canonicalized value with a
 * stable key order rather than a full RFC-8785 implementation (which
 * also normalises numbers). That's enough for the cache-hit invariant
 * (same plan in → same hash out) because the source is always a
 * structured JSON document, never machine-rounded floats.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const o = v as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) sorted[k] = sortKeys(o[k]);
  return sorted;
}

/** sha256 hex of canonicalJson(plan). 64-char lowercase. */
export function hashBusinessPlan(plan: BusinessPlanV2): string {
  return createHash('sha256').update(canonicalJson(plan), 'utf8').digest('hex');
}

// -------------------------------------------------------------------------
// Diff summary helpers
// -------------------------------------------------------------------------

export interface DiffSummary {
  added_sections: string[];
  removed_sections: string[];
  changed_fields: { path: string; from: unknown; to: unknown }[];
  field_count_delta: string;
}

/**
 * Compute a structural diff between two business plans. Operates on the
 * `sections` map (an object keyed by section id). No LLM.
 */
export function diffBusinessPlans(prev: BusinessPlanV2, next: BusinessPlanV2): DiffSummary {
  const prevSections = (prev.sections ?? {}) as Record<string, unknown>;
  const nextSections = (next.sections ?? {}) as Record<string, unknown>;
  const prevKeys = new Set(Object.keys(prevSections));
  const nextKeys = new Set(Object.keys(nextSections));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: { path: string; from: unknown; to: unknown }[] = [];

  for (const k of nextKeys) {
    if (!prevKeys.has(k)) added.push(k);
    else if (canonicalJson(prevSections[k]) !== canonicalJson(nextSections[k])) {
      changed.push({ path: `sections.${k}`, from: prevSections[k], to: nextSections[k] });
    }
  }
  for (const k of prevKeys) {
    if (!nextKeys.has(k)) removed.push(k);
  }
  added.sort();
  removed.sort();
  changed.sort((a, b) => a.path.localeCompare(b.path));

  return {
    added_sections: added,
    removed_sections: removed,
    changed_fields: changed,
    field_count_delta: `+${added.length} added, -${removed.length} removed, ~${changed.length} changed`,
  };
}
