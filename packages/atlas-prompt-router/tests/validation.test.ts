import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_MAX_SELECTION,
  asAtlasSubmitPromptRequest,
  validateBody,
} from '../src/validation.js';

const goodTs = '2026-05-24T12:00:00.000Z';

function good(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { prompt: 'make the stats serif', selection: ['WD-home-hero-slide-01-stats'], ts: goodTs, ...overrides };
}

describe('validateBody', () => {
  it('accepts a minimal well-formed body', () => {
    const r = validateBody(good());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.prompt).toBe('make the stats serif');
    expect(r.value.promptGroupId).toBeNull();
  });
  it('rejects non-object bodies', () => {
    expect(validateBody(null).ok).toBe(false);
    expect(validateBody('hi').ok).toBe(false);
    expect(validateBody([]).ok).toBe(false);
    const r = validateBody(42);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('invalid-body');
  });
  it('rejects body exceeding the byte cap', () => {
    const huge = 'x'.repeat(DEFAULT_MAX_BODY_BYTES + 100);
    const r = validateBody(good({ prompt: huge }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('body-too-large');
  });
  it('trims the prompt before length checks', () => {
    const r = validateBody(good({ prompt: '   hi   ' }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.prompt).toBe('hi');
  });
  it('rejects empty / whitespace-only prompts', () => {
    expect(validateBody(good({ prompt: '' })).ok).toBe(false);
    const r = validateBody(good({ prompt: '   \n\t  ' }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('invalid-prompt');
  });
  it('rejects non-string prompts', () => {
    const r = validateBody(good({ prompt: 123 }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('invalid-prompt');
  });
  it('rejects prompts beyond maxPromptChars', () => {
    const huge = 'x'.repeat(DEFAULT_MAX_PROMPT_CHARS + 1);
    const r = validateBody(good({ prompt: huge }), { maxBodyBytes: 10 * 1024 * 1024 });
    expect(r.ok).toBe(false);
  });
  it('honors custom minPromptChars', () => {
    const r = validateBody(good({ prompt: 'hi' }), { minPromptChars: 5 });
    expect(r.ok).toBe(false);
  });
  it('rejects missing selection', () => {
    const r = validateBody(good({ selection: undefined }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error.kind).toBe('invalid-selection');
  });
  it('rejects empty selection arrays', () => {
    expect(validateBody(good({ selection: [] })).ok).toBe(false);
  });
  it('rejects selection beyond maxSelection', () => {
    const r = validateBody(good({
      selection: Array.from({ length: DEFAULT_MAX_SELECTION + 1 }, (_, i) => `T-${i}`),
    }));
    expect(r.ok).toBe(false);
  });
  it('rejects non-string selection entries', () => {
    expect(validateBody(good({ selection: [123] })).ok).toBe(false);
  });
  it('rejects empty-string selection entries', () => {
    expect(validateBody(good({ selection: [''] })).ok).toBe(false);
  });
  it('rejects oversize ticket ids', () => {
    expect(validateBody(good({ selection: ['x'.repeat(300)] })).ok).toBe(false);
  });
  it('rejects non-ASCII-printable ticket ids', () => {
    expect(validateBody(good({ selection: ['hello world'] })).ok).toBe(false);
  });
  it('rejects duplicate ticket ids in selection', () => {
    expect(validateBody(good({ selection: ['A', 'B', 'A'] })).ok).toBe(false);
  });
  it('accepts multi-select with distinct ticket ids', () => {
    const r = validateBody(good({ selection: ['A', 'B', 'C'] }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.selection).toEqual(['A', 'B', 'C']);
  });
  it('rejects missing ts', () => {
    expect(validateBody(good({ ts: undefined })).ok).toBe(false);
  });
  it('rejects unparseable ts', () => {
    expect(validateBody(good({ ts: 'not a date' })).ok).toBe(false);
  });
  it('accepts a non-UTC ts', () => {
    expect(validateBody(good({ ts: '2026-05-24T12:00:00+05:30' })).ok).toBe(true);
  });
  it('accepts a missing promptGroupId', () => {
    const r = validateBody(good());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.promptGroupId).toBeNull();
  });
  it('accepts a null promptGroupId', () => {
    const r = validateBody(good({ promptGroupId: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.promptGroupId).toBeNull();
  });
  it('accepts a well-formed promptGroupId', () => {
    const r = validateBody(good({ promptGroupId: 'pg_abc-123' }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.value.promptGroupId).toBe('pg_abc-123');
  });
  it('rejects empty promptGroupId', () => {
    expect(validateBody(good({ promptGroupId: '' })).ok).toBe(false);
  });
  it('rejects promptGroupId with invalid characters', () => {
    expect(validateBody(good({ promptGroupId: 'pg with space' })).ok).toBe(false);
  });
  it('rejects oversize promptGroupId', () => {
    expect(validateBody(good({ promptGroupId: 'a'.repeat(100) })).ok).toBe(false);
  });
});

describe('asAtlasSubmitPromptRequest', () => {
  it('preserves the wire shape', () => {
    const v = validateBody(good({ promptGroupId: 'pg_x' }));
    if (!v.ok) throw new Error('unreachable');
    const wire = asAtlasSubmitPromptRequest(v.value);
    expect(wire.prompt).toBe('make the stats serif');
    expect(wire.promptGroupId).toBe('pg_x');
    expect(wire.ts).toBe(goodTs);
  });
});
