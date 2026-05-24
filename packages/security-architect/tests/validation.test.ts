/**
 * Output validation tests.
 */
import { describe, it, expect } from 'vitest';
import { SECURITY_OWNED_FIELD_KEYS } from '../src/contract.js';
import { stripFences, validateArchitectOutput } from '../src/validation.js';
import { goldenAssistantText, goldenExpectedOutput } from './helpers/fakes.js';

describe('validateArchitectOutput — happy path', () => {
  it('accepts the canonical golden output', () => {
    const r = validateArchitectOutput(goldenAssistantText(), SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.parsed?.architectName).toBe('security');
    expect(r.parsed?.status).toBe('ok');
  });
  it('accepts JSON wrapped in ```json fences', () => {
    const fenced = '```json\n' + goldenAssistantText() + '\n```';
    expect(validateArchitectOutput(fenced, SECURITY_OWNED_FIELD_KEYS).ok).toBe(true);
  });
  it('accepts JSON wrapped in plain ``` fences', () => {
    const fenced = '```\n' + goldenAssistantText() + '\n```';
    expect(validateArchitectOutput(fenced, SECURITY_OWNED_FIELD_KEYS).ok).toBe(true);
  });
});

describe('validateArchitectOutput — error paths', () => {
  it('rejects invalid JSON', () => {
    const r = validateArchitectOutput('{not json', SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('invalid-json');
  });
  it('rejects a top-level array', () => {
    const r = validateArchitectOutput('[1,2,3]', SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('wrong-top-level-type');
  });
  it('rejects null top-level', () => {
    const r = validateArchitectOutput('null', SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('wrong-top-level-type');
  });
  it('flags missing top-level keys', () => {
    const r = validateArchitectOutput('{"architectName":"security"}', SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('missing-top-level-key');
  });
  it('flags a missing owned field', () => {
    const g = goldenExpectedOutput();
    const fields = { ...g.architectureFields } as Record<string, unknown>;
    delete fields['security.owaspMitigations'];
    const corrupted = { ...g, architectureFields: fields };
    const r = validateArchitectOutput(JSON.stringify(corrupted), SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'missing-owned-field')).toBe(true);
  });
  it('flags an unexpected field outside owned namespace', () => {
    const g = goldenExpectedOutput();
    const fields = { ...g.architectureFields, 'backend.apiEndpoints': 'not yours' };
    const corrupted = { ...g, architectureFields: fields };
    const r = validateArchitectOutput(JSON.stringify(corrupted), SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'unexpected-field')).toBe(true);
  });
  it('flags out-of-range confidence', () => {
    const r = validateArchitectOutput(JSON.stringify({ ...goldenExpectedOutput(), confidence: 1.5 }), SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'confidence-out-of-range')).toBe(true);
  });
  it('flags negative confidence', () => {
    const r = validateArchitectOutput(JSON.stringify({ ...goldenExpectedOutput(), confidence: -0.1 }), SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'confidence-out-of-range')).toBe(true);
  });
  it('flags overly long notes', () => {
    const r = validateArchitectOutput(JSON.stringify({ ...goldenExpectedOutput(), notes: 'x'.repeat(801) }), SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'notes-too-long')).toBe(true);
  });
  it('flags too many risk entries', () => {
    const r = validateArchitectOutput(JSON.stringify({ ...goldenExpectedOutput(), risks: ['a','b','c','d','e','f'] }), SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'too-many-risks')).toBe(true);
  });
  it('flags invalid status', () => {
    const r = validateArchitectOutput(JSON.stringify({ ...goldenExpectedOutput(), status: 'bananas' }), SECURITY_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'invalid-status')).toBe(true);
  });
  it('accepts every legal status value', () => {
    for (const s of ['ok', 'partial', 'failed']) {
      const r = validateArchitectOutput(JSON.stringify({ ...goldenExpectedOutput(), status: s }), SECURITY_OWNED_FIELD_KEYS);
      expect(r.ok).toBe(true);
    }
  });
});

describe('stripFences', () => {
  it('strips ```json fences', () => { expect(stripFences('```json\n{"x":1}\n```')).toBe('{"x":1}'); });
  it('strips plain ``` fences', () => { expect(stripFences('```\n{"x":1}\n```')).toBe('{"x":1}'); });
  it('passes plain JSON through unchanged', () => { expect(stripFences('{"x":1}')).toBe('{"x":1}'); });
  it('trims surrounding whitespace', () => { expect(stripFences('   {"x":1}   ')).toBe('{"x":1}'); });
});
