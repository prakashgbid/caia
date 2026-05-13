/**
 * Verifier verdict validator.
 *
 * Hand-rolled JSON-Schema walker (no external dep) that validates the
 * verifier's strict-JSON output against templates/verifier_verdict_schema.json.
 * Mirrors the stdlib pattern in @chiefaia/local-llm-router-py-client's
 * spawn_prompt_loader.py — covers type / enum / const / pattern / required /
 * additionalProperties / items / minLength / maxLength / minimum / anyOf.
 */

import { loadVerdictSchema } from './prompt-builder.js';
import type { VerifierVerdict } from './types.js';

type SchemaNode = Record<string, unknown>;

function walk(value: unknown, schema: SchemaNode, path: string, errors: string[]): void {
  // anyOf
  if (Array.isArray(schema.anyOf)) {
    const branchErrors: string[][] = [];
    for (const sub of schema.anyOf) {
      const local: string[] = [];
      walk(value, sub as SchemaNode, path, local);
      if (local.length === 0) return;
      branchErrors.push(local);
    }
    errors.push(`${path}: did not match any anyOf branch (${branchErrors.length} attempted)`);
    return;
  }

  // const
  if ('const' in schema) {
    if (value !== schema.const) {
      errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    }
    return;
  }

  // type
  const t = schema.type as string | string[] | undefined;
  if (t !== undefined) {
    const types = Array.isArray(t) ? t : [t];
    let typeOk = false;
    for (const ty of types) {
      if (ty === 'string' && typeof value === 'string') typeOk = true;
      else if (ty === 'integer' && typeof value === 'number' && Number.isInteger(value)) typeOk = true;
      else if (ty === 'number' && typeof value === 'number') typeOk = true;
      else if (ty === 'boolean' && typeof value === 'boolean') typeOk = true;
      else if (ty === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) typeOk = true;
      else if (ty === 'array' && Array.isArray(value)) typeOk = true;
      else if (ty === 'null' && value === null) typeOk = true;
    }
    if (!typeOk) {
      errors.push(`${path}: expected type ${JSON.stringify(t)}, got ${typeof value}`);
      return;
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value as never)) {
      errors.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
      return;
    }
  }

  // string-specific
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: string length ${value.length} < minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path}: string length ${value.length} > maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        errors.push(`${path}: string does not match pattern ${schema.pattern}`);
      }
    }
  }

  // number-specific
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: number ${value} < minimum ${schema.minimum}`);
    }
  }

  // object-specific
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const req of schema.required as string[]) {
        if (!(req in obj)) {
          errors.push(`${path}: missing required field "${req}"`);
        }
      }
    }
    const props = (schema.properties as Record<string, SchemaNode> | undefined) ?? {};
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(obj)) {
        if (!(k in props)) {
          errors.push(`${path}: unexpected field "${k}" (additionalProperties: false)`);
        }
      }
    }
    for (const [k, subSchema] of Object.entries(props)) {
      if (k in obj) {
        walk(obj[k], subSchema, `${path}.${k}`, errors);
      }
    }
  }

  // array-specific
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], schema.items as SchemaNode, `${path}[${i}]`, errors);
    }
  }
}

export function validateVerifierVerdict(blob: unknown): { ok: boolean; errors: string[] } {
  const schema = loadVerdictSchema();
  const errors: string[] = [];
  walk(blob, schema, '$', errors);
  return { ok: errors.length === 0, errors };
}

/** Parse the spawn's last stdout line and validate it against the schema. */
export function parseAndValidateVerdict(rawLine: string): {
  ok: boolean;
  verdict: VerifierVerdict | null;
  errors: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch (e) {
    return { ok: false, verdict: null, errors: [`JSON.parse failed: ${(e as Error).message}`] };
  }
  const { ok, errors } = validateVerifierVerdict(parsed);
  return { ok, verdict: ok ? (parsed as VerifierVerdict) : null, errors };
}
