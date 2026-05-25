/**
 * Output validation — defensive checks on what the subagent returns
 * before we hand the `AuthorOutput` back to the orchestrator.
 *
 * The shape we validate is the LLM's claimed response — i.e. the JSON
 * the spawner returned. We:
 *   1. Strip ```json fences if the LLM forgot to follow the contract.
 *   2. Parse JSON, check top-level keys, ranges.
 *   3. Validate every `testCases[i]` matches the canonical
 *      `@chiefaia/ticket-template` shape (category in the enum, layer
 *      in the enum, all required fields present).
 *   4. Drop unknown keys per case (the upstream Zod schema is
 *      `.strict()`).
 *
 * The validator never throws on bad LLM output — it returns a typed
 * result so the agent can decide to retry or report `partial`.
 */

import type { TestCase } from '@chiefaia/ticket-template';

import type { AuthorOutput } from './types.js';
import { AUTHOR_HARD_BOUNDS } from './contract.js';

export interface ValidationError {
  code:
    | 'invalid-json'
    | 'missing-top-level-key'
    | 'wrong-top-level-type'
    | 'missing-test-cases'
    | 'too-many-test-cases'
    | 'confidence-out-of-range'
    | 'notes-too-long'
    | 'too-many-risks'
    | 'invalid-status'
    | 'invalid-test-case-category'
    | 'invalid-test-case-layer'
    | 'missing-test-case-field'
    | 'invalid-linked-ac-index';
  message: string;
  field?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: readonly ValidationError[];
  parsed?: AuthorOutput;
}

const TOP_LEVEL_KEYS = [
  'agentName',
  'testCases',
  'confidence',
  'notes',
  'dependencies',
  'risks',
  'toolCalls',
  'spend',
  'status'
] as const;

const ALLOWED_STATUSES: readonly string[] = ['ok', 'partial', 'failed'];

const TEST_CASE_CATEGORIES = new Set([
  'happy',
  'edge',
  'error',
  'accessibility',
  'security',
  'performance',
  'visual'
]);

const TEST_CASE_LAYERS = new Set([
  'unit',
  'integration',
  'e2e',
  'visual',
  'accessibility'
]);

const REQUIRED_TEST_CASE_FIELDS = [
  'id',
  'title',
  'category',
  'layer',
  'given',
  'when',
  'then'
] as const;

export function stripFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  return s.trim();
}

export function validateAuthorOutput(
  text: string,
  acceptanceCriteriaLength: number
): ValidationResult {
  const errors: ValidationError[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return {
      ok: false,
      errors: [{ code: 'invalid-json', message: 'response is not valid JSON' }]
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      errors: [
        { code: 'wrong-top-level-type', message: 'response root must be a JSON object' }
      ]
    };
  }

  const obj = parsed as Record<string, unknown>;
  for (const k of TOP_LEVEL_KEYS) {
    if (!(k in obj)) {
      errors.push({ code: 'missing-top-level-key', message: `missing key`, field: k });
    }
  }

  if (typeof obj['confidence'] !== 'number' || obj['confidence'] < 0 || obj['confidence'] > 1) {
    errors.push({
      code: 'confidence-out-of-range',
      message: 'confidence must be a number in [0,1]',
      field: 'confidence'
    });
  }

  if (typeof obj['notes'] === 'string' && obj['notes'].length > AUTHOR_HARD_BOUNDS.maxNotesChars) {
    errors.push({
      code: 'notes-too-long',
      message: `notes longer than ${AUTHOR_HARD_BOUNDS.maxNotesChars} chars`,
      field: 'notes'
    });
  }

  if (Array.isArray(obj['risks']) && obj['risks'].length > AUTHOR_HARD_BOUNDS.maxRisks) {
    errors.push({
      code: 'too-many-risks',
      message: `risks longer than ${AUTHOR_HARD_BOUNDS.maxRisks}`,
      field: 'risks'
    });
  }

  if (typeof obj['status'] !== 'string' || !ALLOWED_STATUSES.includes(obj['status'])) {
    errors.push({
      code: 'invalid-status',
      message: `status must be one of ${ALLOWED_STATUSES.join('|')}`,
      field: 'status'
    });
  }

  if (!Array.isArray(obj['testCases'])) {
    errors.push({
      code: 'missing-test-cases',
      message: 'testCases must be an array',
      field: 'testCases'
    });
    return { ok: false, errors };
  }

  const cases = obj['testCases'];
  if (cases.length > AUTHOR_HARD_BOUNDS.maxCases) {
    errors.push({
      code: 'too-many-test-cases',
      message: `testCases length ${cases.length} > cap ${AUTHOR_HARD_BOUNDS.maxCases}`,
      field: 'testCases'
    });
  }

  const accepted: TestCase[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c === null || typeof c !== 'object' || Array.isArray(c)) {
      errors.push({
        code: 'missing-test-case-field',
        message: `testCases[${i}] must be an object`,
        field: `testCases[${i}]`
      });
      continue;
    }
    const tc = c as Record<string, unknown>;
    let invalid = false;
    for (const f of REQUIRED_TEST_CASE_FIELDS) {
      if (typeof tc[f] !== 'string' || (tc[f] as string).length === 0) {
        errors.push({
          code: 'missing-test-case-field',
          message: `testCases[${i}].${f} missing or empty`,
          field: `testCases[${i}].${f}`
        });
        invalid = true;
      }
    }
    if (typeof tc['category'] === 'string' && !TEST_CASE_CATEGORIES.has(tc['category'])) {
      errors.push({
        code: 'invalid-test-case-category',
        message: `testCases[${i}].category '${String(tc['category'])}' not in canonical set`,
        field: `testCases[${i}].category`
      });
      invalid = true;
    }
    if (typeof tc['layer'] === 'string' && !TEST_CASE_LAYERS.has(tc['layer'])) {
      errors.push({
        code: 'invalid-test-case-layer',
        message: `testCases[${i}].layer '${String(tc['layer'])}' not in canonical set`,
        field: `testCases[${i}].layer`
      });
      invalid = true;
    }
    if ('linkedAcceptanceCriterionIndex' in tc) {
      const idx = tc['linkedAcceptanceCriterionIndex'];
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= acceptanceCriteriaLength) {
        errors.push({
          code: 'invalid-linked-ac-index',
          message: `testCases[${i}].linkedAcceptanceCriterionIndex ${String(idx)} out of bounds for acceptanceCriteria length ${acceptanceCriteriaLength}`,
          field: `testCases[${i}].linkedAcceptanceCriterionIndex`
        });
        invalid = true;
      }
    }
    if (invalid) continue;

    // Build a canonical TestCase, dropping unknown keys (the Zod schema
    // in @chiefaia/ticket-template is `.strict()` so any stray key
    // would otherwise fail downstream).
    const canonical: TestCase = {
      id: tc['id'] as string,
      title: tc['title'] as string,
      category: tc['category'] as TestCase['category'],
      layer: tc['layer'] as TestCase['layer'],
      given: tc['given'] as string,
      when: tc['when'] as string,
      then: tc['then'] as string,
      selectorHints: normaliseStringArray(tc['selectorHints']),
      mocks: normaliseMocks(tc['mocks']),
      required: typeof tc['required'] === 'boolean' ? tc['required'] : true,
      status: typeof tc['status'] === 'string' ? (tc['status'] as TestCase['status']) : 'pending',
      designedBy: typeof tc['designedBy'] === 'string' && (tc['designedBy'] as string).length > 0 ? (tc['designedBy'] as string) : 'test-author',
      designedAt: typeof tc['designedAt'] === 'number' ? (tc['designedAt'] as number) : Date.now(),
      ...(typeof tc['linkedAcceptanceCriterionIndex'] === 'number'
        ? { linkedAcceptanceCriterionIndex: tc['linkedAcceptanceCriterionIndex'] as number }
        : {})
    };
    accepted.push(canonical);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const finalOutput: AuthorOutput = {
    agentName: 'test-author',
    testCases: accepted,
    testDesign: {
      designedBy: typeof obj['agentName'] === 'string' ? (obj['agentName'] as string) : 'test-author',
      designedAt: Date.now(),
      totalCases: accepted.length,
      categoryCounts: countByCategory(accepted),
      layerCounts: countByLayer(accepted)
    },
    confidence: obj['confidence'] as number,
    notes: typeof obj['notes'] === 'string' ? (obj['notes'] as string) : '',
    dependencies: Array.isArray(obj['dependencies'])
      ? (obj['dependencies'] as string[]).filter((d): d is string => typeof d === 'string')
      : [],
    risks: Array.isArray(obj['risks'])
      ? (obj['risks'] as string[]).filter((r): r is string => typeof r === 'string').slice(0, AUTHOR_HARD_BOUNDS.maxRisks)
      : [],
    toolCalls: [],
    spend: {
      inputTokens: 0,
      outputTokens: 0,
      usdCost: 0,
      wallClockMs: 0,
      model: 'sonnet'
    },
    status: obj['status'] as AuthorOutput['status']
  };
  return { ok: true, errors: [], parsed: finalOutput };
}

function normaliseStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

interface RawMock {
  method?: unknown;
  url?: unknown;
  status?: unknown;
  body?: unknown;
}

function normaliseMocks(v: unknown): TestCase['mocks'] {
  if (!Array.isArray(v)) return [];
  const out: TestCase['mocks'] = [];
  for (const m of v as RawMock[]) {
    if (m === null || typeof m !== 'object') continue;
    const method = m.method;
    const url = m.url;
    if (
      typeof method !== 'string' ||
      typeof url !== 'string' ||
      url.length === 0 ||
      !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ) {
      continue;
    }
    out.push({
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url,
      status: typeof m.status === 'number' ? m.status : 200,
      body: typeof m.body === 'string' ? m.body : ''
    });
  }
  return out;
}

function countByCategory(cases: readonly TestCase[]): AuthorOutput['testDesign']['categoryCounts'] {
  const counts: AuthorOutput['testDesign']['categoryCounts'] = {
    happy: 0,
    edge: 0,
    error: 0,
    accessibility: 0,
    security: 0,
    performance: 0,
    visual: 0
  };
  for (const tc of cases) counts[tc.category] += 1;
  return counts;
}

function countByLayer(cases: readonly TestCase[]): AuthorOutput['testDesign']['layerCounts'] {
  const counts: AuthorOutput['testDesign']['layerCounts'] = {
    unit: 0,
    integration: 0,
    e2e: 0,
    visual: 0,
    accessibility: 0
  };
  for (const tc of cases) counts[tc.layer] += 1;
  return counts;
}
