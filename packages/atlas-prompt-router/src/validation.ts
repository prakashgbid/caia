/**
 * Inbound request validation.
 *
 * Spec rules (§4.1 + §4.5):
 *   - `prompt`     — required, non-empty after trim, ≤ maxPromptChars.
 *   - `selection`  — required, ≥1 ticket id, well-formed, no dupes.
 *   - `ts`         — required, valid ISO-8601.
 *   - `promptGroupId` — optional, 1..64 chars, `[A-Za-z0-9_-]+`.
 *   - whole body wire size ≤ maxBodyBytes (default 64 KiB).
 */

import type { AtlasSubmitPromptRequest, RouterOptions } from './types.js';

export type ValidationFailure =
  | { readonly kind: 'invalid-body'; readonly field?: string; readonly message: string }
  | {
      readonly kind: 'invalid-prompt';
      readonly field: 'prompt';
      readonly message: string;
      readonly limit?: number;
      readonly got?: number;
    }
  | {
      readonly kind: 'invalid-selection';
      readonly field: 'selection';
      readonly message: string;
      readonly limit?: number;
      readonly got?: number | string;
    }
  | { readonly kind: 'invalid-ts'; readonly field: 'ts'; readonly message: string }
  | {
      readonly kind: 'invalid-prompt-group-id';
      readonly field: 'promptGroupId';
      readonly message: string;
    }
  | {
      readonly kind: 'body-too-large';
      readonly limit: number;
      readonly got: number;
      readonly message: string;
    };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ValidationFailure };

export interface ValidatedBody {
  readonly prompt: string;
  readonly selection: ReadonlyArray<string>;
  readonly promptGroupId: string | null;
  readonly ts: string;
}

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
export const DEFAULT_MAX_PROMPT_CHARS = 8192;
export const DEFAULT_MIN_PROMPT_CHARS = 1;
export const DEFAULT_MAX_SELECTION = 50;
export const DEFAULT_MAX_TICKET_ID_CHARS = 200;
export const DEFAULT_MAX_PROMPT_GROUP_ID_CHARS = 64;

const PROMPT_GROUP_ID_RE = /^[A-Za-z0-9_-]+$/;
const TICKET_ID_RE = /^[\x21-\x7E]+$/u;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function byteLengthUtf8(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function validateBody(
  raw: unknown,
  opts: Pick<
    RouterOptions,
    'maxBodyBytes' | 'maxPromptChars' | 'minPromptChars' | 'maxSelection' | 'maxTicketIdChars'
  > = {},
): ValidationResult<ValidatedBody> {
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxPromptChars = opts.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const minPromptChars = opts.minPromptChars ?? DEFAULT_MIN_PROMPT_CHARS;
  const maxSelection = opts.maxSelection ?? DEFAULT_MAX_SELECTION;
  const maxTicketIdChars = opts.maxTicketIdChars ?? DEFAULT_MAX_TICKET_ID_CHARS;

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: { kind: 'invalid-body', message: 'request body must be a JSON object' },
    };
  }

  const serialised = JSON.stringify(raw);
  const bodyBytes = byteLengthUtf8(serialised);
  if (bodyBytes > maxBodyBytes) {
    return {
      ok: false,
      error: {
        kind: 'body-too-large',
        limit: maxBodyBytes,
        got: bodyBytes,
        message: `request body is ${bodyBytes} bytes; limit is ${maxBodyBytes}`,
      },
    };
  }

  const promptRaw = raw['prompt'];
  if (typeof promptRaw !== 'string') {
    return {
      ok: false,
      error: { kind: 'invalid-prompt', field: 'prompt', message: `'prompt' must be a string` },
    };
  }
  const prompt = promptRaw.trim();
  if (prompt.length < minPromptChars) {
    return {
      ok: false,
      error: {
        kind: 'invalid-prompt',
        field: 'prompt',
        message: `'prompt' must be at least ${minPromptChars} character(s) after trim`,
        limit: minPromptChars,
        got: prompt.length,
      },
    };
  }
  if (prompt.length > maxPromptChars) {
    return {
      ok: false,
      error: {
        kind: 'invalid-prompt',
        field: 'prompt',
        message: `'prompt' is ${prompt.length} chars; limit is ${maxPromptChars}`,
        limit: maxPromptChars,
        got: prompt.length,
      },
    };
  }

  const selRaw = raw['selection'];
  if (!Array.isArray(selRaw)) {
    return {
      ok: false,
      error: {
        kind: 'invalid-selection',
        field: 'selection',
        message: `'selection' must be a non-empty array of ticket ids`,
      },
    };
  }
  if (selRaw.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'invalid-selection',
        field: 'selection',
        message: `'selection' must contain at least one ticket id`,
        got: 0,
      },
    };
  }
  if (selRaw.length > maxSelection) {
    return {
      ok: false,
      error: {
        kind: 'invalid-selection',
        field: 'selection',
        message: `'selection' has ${selRaw.length} entries; limit is ${maxSelection}`,
        limit: maxSelection,
        got: selRaw.length,
      },
    };
  }
  const seen = new Set<string>();
  const selection: string[] = [];
  for (let i = 0; i < selRaw.length; i++) {
    const id = selRaw[i];
    if (typeof id !== 'string' || id.length === 0) {
      return {
        ok: false,
        error: {
          kind: 'invalid-selection',
          field: 'selection',
          message: `'selection[${i}]' must be a non-empty string`,
        },
      };
    }
    if (id.length > maxTicketIdChars) {
      return {
        ok: false,
        error: {
          kind: 'invalid-selection',
          field: 'selection',
          message: `'selection[${i}]' is ${id.length} chars; limit is ${maxTicketIdChars}`,
          limit: maxTicketIdChars,
          got: id,
        },
      };
    }
    if (!TICKET_ID_RE.test(id)) {
      return {
        ok: false,
        error: {
          kind: 'invalid-selection',
          field: 'selection',
          message: `'selection[${i}]' contains non-ASCII-printable characters`,
          got: id,
        },
      };
    }
    if (seen.has(id)) {
      return {
        ok: false,
        error: {
          kind: 'invalid-selection',
          field: 'selection',
          message: `'selection' contains the duplicate id '${id}'`,
          got: id,
        },
      };
    }
    seen.add(id);
    selection.push(id);
  }

  const tsRaw = raw['ts'];
  if (typeof tsRaw !== 'string' || tsRaw.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'invalid-ts',
        field: 'ts',
        message: `'ts' must be a non-empty ISO-8601 string`,
      },
    };
  }
  const tsParsed = new Date(tsRaw);
  if (Number.isNaN(tsParsed.getTime())) {
    return {
      ok: false,
      error: {
        kind: 'invalid-ts',
        field: 'ts',
        message: `'ts' is not a valid ISO-8601 timestamp`,
      },
    };
  }

  const pgidRaw = raw['promptGroupId'];
  let promptGroupId: string | null = null;
  if (pgidRaw !== undefined && pgidRaw !== null) {
    if (typeof pgidRaw !== 'string' || pgidRaw.length === 0) {
      return {
        ok: false,
        error: {
          kind: 'invalid-prompt-group-id',
          field: 'promptGroupId',
          message: `'promptGroupId' must be a non-empty string when provided`,
        },
      };
    }
    if (pgidRaw.length > DEFAULT_MAX_PROMPT_GROUP_ID_CHARS) {
      return {
        ok: false,
        error: {
          kind: 'invalid-prompt-group-id',
          field: 'promptGroupId',
          message: `'promptGroupId' is ${pgidRaw.length} chars; limit is ${DEFAULT_MAX_PROMPT_GROUP_ID_CHARS}`,
        },
      };
    }
    if (!PROMPT_GROUP_ID_RE.test(pgidRaw)) {
      return {
        ok: false,
        error: {
          kind: 'invalid-prompt-group-id',
          field: 'promptGroupId',
          message: `'promptGroupId' must match [A-Za-z0-9_-]+`,
        },
      };
    }
    promptGroupId = pgidRaw;
  }

  return { ok: true, value: { prompt, selection, promptGroupId, ts: tsRaw } };
}

export function asAtlasSubmitPromptRequest(b: ValidatedBody): AtlasSubmitPromptRequest {
  return {
    prompt: b.prompt,
    selection: [...b.selection],
    promptGroupId: b.promptGroupId,
    ts: b.ts,
  };
}
