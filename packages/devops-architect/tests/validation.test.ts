/**
 * Output validation tests.
 */
import { describe, it, expect } from 'vitest';
import { DEVOPS_OWNED_FIELD_KEYS } from '../src/contract.js';
import { stripFences, validateArchitectOutput } from '../src/validation.js';
import { goldenAssistantText, goldenExpectedOutput } from './helpers/fakes.js';

describe('validateArchitectOutput - happy path', () => {
  it('accepts the canonical golden output', () => {
    const result = validateArchitectOutput(goldenAssistantText(), DEVOPS_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.parsed?.architectName).toBe('devops');
    expect(result.parsed?.status).toBe('ok');
  });
  it('accepts JSON wrapped in ```json fences', () => {
    const fenced = '```json\n' + goldenAssistantText() + '\n```';
    expect(validateArchitectOutput(fenced, DEVOPS_OWNED_FIELD_KEYS).ok).toBe(true);
  });
  it('accepts JSON wrapped in plain ``` fences', () => {
    const fenced = '```\n' + goldenAssistantText() + '\n```';
    expect(validateArchitectOutput(fenced, DEVOPS_OWNED_FIELD_KEYS).ok).toBe(true);
  });
});

describe('validateArchitectOutput - error paths', () => {
  it('rejects invalid JSON', () => {
    const r = validateArchitectOutput('{not json', DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('invalid-json');
  });
  it('rejects a top-level array', () => {
    const r = validateArchitectOutput('[1,2,3]', DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('wrong-top-level-type');
  });
  it('rejects null top-level', () => {
    const r = validateArchitectOutput('null', DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('wrong-top-level-type');
  });
  it('flags missing top-level keys', () => {
    const r = validateArchitectOutput('{"architectName":"devops"}', DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.map(e => e.code)).toContain('missing-top-level-key');
  });
  it('flags a missing owned field', () => {
    const golden = goldenExpectedOutput();
    const fields = { ...golden.architectureFields } as Record<string, unknown>;
    delete fields['devops.deployStrategy'];
    const corrupted = { ...golden, architectureFields: fields };
    const r = validateArchitectOutput(JSON.stringify(corrupted), DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'missing-owned-field')).toBe(true);
  });
  it('flags an unexpected field outside the owned namespace', () => {
    const golden = goldenExpectedOutput();
    const fields = { ...golden.architectureFields, 'backend.apiShape': 'not yours' };
    const corrupted = { ...golden, architectureFields: fields };
    const r = validateArchitectOutput(JSON.stringify(corrupted), DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'unexpected-field')).toBe(true);
  });
  it('flags out-of-range confidence', () => {
    const corrupted = { ...goldenExpectedOutput(), confidence: 1.5 };
    const r = validateArchitectOutput(JSON.stringify(corrupted), DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'confidence-out-of-range')).toBe(true);
  });
  it('flags negative confidence', () => {
    const corrupted = { ...goldenExpectedOutput(), confidence: -0.1 };
    const r = validateArchitectOutput(JSON.stringify(corrupted), DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'confidence-out-of-range')).toBe(true);
  });
  it('flags overly long notes', () => {
    const corrupted = { ...goldenExpectedOutput(), notes: 'x'.repeat(801) };
    const r = validateArchitectOutput(JSON.stringify(corrupted), DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'notes-too-long')).toBe(true);
  });
  it('flags too many risk entries', () => {
    const corrupted = { ...goldenExpectedOutput(), risks: ['a', 'b', 'c', 'd', 'e', 'f'] };
    const r = validateArchitectOutput(JSON.stringify(corrupted), DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'too-many-risks')).toBe(true);
  });
  it('flags invalid status', () => {
    const corrupted = { ...goldenExpectedOutput(), status: 'bananas' };
    const r = validateArchitectOutput(JSON.stringify(corrupted), DEVOPS_OWNED_FIELD_KEYS);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === 'invalid-status')).toBe(true);
  });
  it('accepts every legal status value', () => {
    for (const s of ['ok', 'partial', 'failed']) {
      const variant = { ...goldenExpectedOutput(), status: s };
      expect(validateArchitectOutput(JSON.stringify(variant), DEVOPS_OWNED_FIELD_KEYS).ok).toBe(true);
    }
  });
});

describe('stripFences', () => {
  it('strips ```json fences', () => {
    expect(stripFences('```json\n{"x":1}\n```')).toBe('{"x":1}');
  });
  it('strips plain ``` fences', () => {
    expect(stripFences('```\n{"x":1}\n```')).toBe('{"x":1}');
  });
  it('passes plain JSON through unchanged', () => {
    expect(stripFences('{"x":1}')).toBe('{"x":1}');
  });
  it('trims surrounding whitespace', () => {
    expect(stripFences('   {"x":1}   ')).toBe('{"x":1}');
  });
});
