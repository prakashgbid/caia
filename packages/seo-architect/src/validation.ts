/**
 * Output validation — defensive checks on what the subagent returns
 * before we hand the `ArchitectOutput` back to the Dispatcher.
 *
 * Two layers:
 *
 *   1. **Structural** — does the JSON parse, and does it have the
 *      required top-level keys (`architectName`, `architectureFields`,
 *      `confidence`, `notes`, `dependencies`, `risks`, `toolCalls`,
 *      `spend`, `status`)?
 *
 *   2. **Contract** — does `architectureFields` contain exactly the keys
 *      this architect owns (no extras, no missing)? This is the
 *      Dispatcher's first invariant per spec §3.4.
 *
 * Mirrors the Frontend Architect template verbatim — this file should
 * be identical across all 17 architects.
 */

import type { ArchitectOutput } from './types.js';

export interface ValidationError {
  code:
    | 'invalid-json'
    | 'missing-top-level-key'
    | 'wrong-top-level-type'
    | 'missing-owned-field'
    | 'unexpected-field'
    | 'confidence-out-of-range'
    | 'notes-too-long'
    | 'too-many-risks'
    | 'invalid-status';
  message: string;
  field?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: readonly ValidationError[];
  parsed?: ArchitectOutput;
}

const TOP_LEVEL_KEYS = [
  'architectName',
  'architectureFields',
  'confidence',
  'notes',
  'dependencies',
  'risks',
  'toolCalls',
  'spend',
  'status'
] as const;

const ALLOWED_STATUSES: readonly string[] = ['ok', 'partial', 'failed'];
const MAX_NOTES_CHARS = 800;
const MAX_RISKS = 5;

export function validateArchitectOutput(
  text: string,
  ownedFieldKeys: readonly string[]
): ValidationResult {
  const errors: ValidationError[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          code: 'invalid-json',
          message: `Failed to JSON.parse: ${(err as Error).message}`
        }
      ]
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      errors: [
        {
          code: 'wrong-top-level-type',
          message: 'Top-level value must be a JSON object.'
        }
      ]
    };
  }

  const obj = parsed as Record<string, unknown>;

  for (const key of TOP_LEVEL_KEYS) {
    if (!(key in obj)) {
      errors.push({
        code: 'missing-top-level-key',
        message: `Missing required top-level key: '${key}'.`,
        field: key
      });
    }
  }

  if ('architectureFields' in obj) {
    const fields = obj.architectureFields;
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      errors.push({
        code: 'wrong-top-level-type',
        message: '`architectureFields` must be a JSON object.',
        field: 'architectureFields'
      });
    } else {
      const present = new Set(Object.keys(fields as Record<string, unknown>));
      for (const owned of ownedFieldKeys) {
        if (!present.has(owned)) {
          errors.push({
            code: 'missing-owned-field',
            message: `architectureFields is missing owned field '${owned}'.`,
            field: owned
          });
        }
      }
      for (const got of present) {
        if (!ownedFieldKeys.includes(got)) {
          errors.push({
            code: 'unexpected-field',
            message: `architectureFields contains '${got}' which is not owned by this architect.`,
            field: got
          });
        }
      }
    }
  }

  if ('confidence' in obj) {
    const c = obj.confidence;
    if (typeof c !== 'number' || c < 0 || c > 1 || Number.isNaN(c)) {
      errors.push({
        code: 'confidence-out-of-range',
        message: 'confidence must be a number in [0, 1].',
        field: 'confidence'
      });
    }
  }

  if ('notes' in obj) {
    const n = obj.notes;
    if (typeof n === 'string' && n.length > MAX_NOTES_CHARS) {
      errors.push({
        code: 'notes-too-long',
        message: `notes must be <= ${MAX_NOTES_CHARS} chars; got ${n.length}.`,
        field: 'notes'
      });
    }
  }

  if ('risks' in obj) {
    const r = obj.risks;
    if (Array.isArray(r) && r.length > MAX_RISKS) {
      errors.push({
        code: 'too-many-risks',
        message: `risks must have <= ${MAX_RISKS} entries; got ${r.length}.`,
        field: 'risks'
      });
    }
  }

  if ('status' in obj) {
    const s = obj.status;
    if (typeof s !== 'string' || !ALLOWED_STATUSES.includes(s)) {
      errors.push({
        code: 'invalid-status',
        message: `status must be one of ${ALLOWED_STATUSES.join('|')}; got '${String(s)}'.`,
        field: 'status'
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    parsed: obj as unknown as ArchitectOutput
  };
}

/**
 * Strip ``` fences if the assistant slipped them around its JSON.
 */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split('\n');
    lines.shift();
    if (lines[lines.length - 1]?.trim() === '```') {
      lines.pop();
    }
    return lines.join('\n');
  }
  return trimmed;
}
