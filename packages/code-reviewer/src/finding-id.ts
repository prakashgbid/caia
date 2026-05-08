/**
 * Stable id-hash for findings — `dimension|file|line|issueTitle`.
 *
 * Uses a simple, deterministic FNV-1a 32-bit hash over the canonical key.
 * No crypto needed (these are dedup keys, not security tokens).
 */

export interface FindingIdInputs {
  dimension: string;
  file: string;
  line: number;
  issueTitle: string;
}

export function findingId(inputs: FindingIdInputs): string {
  const key = `${inputs.dimension}|${inputs.file}|${inputs.line}|${inputs.issueTitle}`;
  return fnv1a32(key);
}

function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
