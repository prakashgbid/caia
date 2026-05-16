import yaml from 'js-yaml';
import type { ScaffolderChainSpec, ScaffolderPhase } from './types.js';

export class SchemaError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(`scaffolder schema validation failed (${errors.length} error(s)): ${errors.join('; ')}`);
    this.errors = errors;
    this.name = 'SchemaError';
  }
}

/**
 * Parse a YAML string (or already-parsed object) into a ScaffolderChainSpec.
 * Throws SchemaError with a flat list of human-readable errors when invalid.
 *
 * The validator is intentionally stricter than chain-runner's `loadChainSpec`:
 * it requires `success_criteria.output_file`, a `prompt_template`, sequential
 * phase ids starting at 1, and well-formed `deps`. Anything we emit here must
 * still round-trip cleanly through the runner's loader (which is laxer), so
 * the strictness is one-way.
 */
export function parseScaffolderSpec(input: string | unknown): ScaffolderChainSpec {
  let parsed: unknown;
  if (typeof input === 'string') {
    try {
      parsed = yaml.load(extractYamlBlock(input));
    } catch (e) {
      throw new SchemaError([`yaml parse error: ${(e as Error).message}`]);
    }
  } else {
    parsed = input;
  }
  return validateScaffolderSpec(parsed);
}

/**
 * Some LLMs wrap YAML in ```yaml ... ``` fences or add prose around it. Strip
 * the fence if present; otherwise return the input unchanged.
 */
export function extractYamlBlock(text: string): string {
  const fenceRe = /```(?:yaml|yml)?\n([\s\S]*?)\n```/i;
  const m = text.match(fenceRe);
  if (m && m[1]) return m[1];
  return text;
}

export function validateScaffolderSpec(parsed: unknown): ScaffolderChainSpec {
  const errors: string[] = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SchemaError(['root is not an object']);
  }
  const obj = parsed as Record<string, unknown>;

  // ── phases ──────────────────────────────────────────────────────────
  const phasesRaw = obj.phases;
  if (!Array.isArray(phasesRaw)) {
    throw new SchemaError(['phases: missing or not an array']);
  }
  if (phasesRaw.length === 0) {
    throw new SchemaError(['phases: at least one phase required']);
  }
  if (phasesRaw.length > 20) {
    errors.push(`phases: ${phasesRaw.length} is excessive (cap at 20). Scaffolder expects 1–10.`);
  }

  const phases: ScaffolderPhase[] = [];
  const seenIds = new Set<number>();
  phasesRaw.forEach((p, i) => {
    if (!p || typeof p !== 'object') {
      errors.push(`phases[${i}]: not an object`);
      return;
    }
    const ph = p as Record<string, unknown>;
    const where = `phases[${i}]`;
    const id = ph.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
      errors.push(`${where}.id: must be a positive integer, got ${JSON.stringify(id)}`);
    } else if (seenIds.has(id)) {
      errors.push(`${where}.id: duplicate id ${id}`);
    } else {
      seenIds.add(id);
    }
    if (typeof ph.name !== 'string' || ph.name.trim() === '') {
      errors.push(`${where}.name: required non-empty string`);
    }
    if (ph.description !== undefined && typeof ph.description !== 'string') {
      errors.push(`${where}.description: must be a string`);
    }
    if (typeof ph.prompt_template !== 'string' || ph.prompt_template.trim().length < 40) {
      errors.push(`${where}.prompt_template: required string of at least 40 chars (got ${typeof ph.prompt_template === 'string' ? ph.prompt_template.length : typeof ph.prompt_template})`);
    }

    // deps
    let deps: number[] | undefined;
    if (ph.deps !== undefined) {
      if (!Array.isArray(ph.deps)) {
        errors.push(`${where}.deps: must be an array of phase ids`);
      } else {
        deps = [];
        for (let j = 0; j < ph.deps.length; j++) {
          const d = ph.deps[j];
          if (typeof d !== 'number' || !Number.isInteger(d)) {
            errors.push(`${where}.deps[${j}]: must be a phase id (integer)`);
          } else {
            deps.push(d);
          }
        }
      }
    }

    // success_criteria
    const sc = ph.success_criteria;
    const scOut: ScaffolderPhase['success_criteria'] = { output_file: '' };
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) {
      errors.push(`${where}.success_criteria: required object`);
    } else {
      const scObj = sc as Record<string, unknown>;
      if (typeof scObj.output_file !== 'string' || scObj.output_file.trim() === '') {
        errors.push(`${where}.success_criteria.output_file: required non-empty string`);
      } else {
        scOut.output_file = scObj.output_file;
      }
      if (scObj.min_bytes !== undefined) {
        if (typeof scObj.min_bytes !== 'number' || scObj.min_bytes < 0) {
          errors.push(`${where}.success_criteria.min_bytes: must be a non-negative number`);
        } else {
          scOut.min_bytes = scObj.min_bytes;
        }
      }
      if (scObj.grep_match !== undefined) {
        if (typeof scObj.grep_match !== 'string') {
          errors.push(`${where}.success_criteria.grep_match: must be a string regex`);
        } else {
          scOut.grep_match = scObj.grep_match;
        }
      }
      if (scObj.requires_merged_pr !== undefined) {
        if (typeof scObj.requires_merged_pr !== 'boolean') {
          errors.push(`${where}.success_criteria.requires_merged_pr: must be a boolean`);
        } else {
          scOut.requires_merged_pr = scObj.requires_merged_pr;
        }
      }
      if (scObj.enforce !== undefined) {
        if (scObj.enforce !== 'warn' && scObj.enforce !== 'strict') {
          errors.push(`${where}.success_criteria.enforce: must be "warn" or "strict"`);
        } else {
          scOut.enforce = scObj.enforce;
        }
      }
    }

    let max_minutes: number | undefined;
    if (ph.max_minutes !== undefined) {
      if (typeof ph.max_minutes !== 'number' || ph.max_minutes <= 0) {
        errors.push(`${where}.max_minutes: must be a positive number`);
      } else {
        max_minutes = ph.max_minutes;
      }
    }

    const phase: ScaffolderPhase = {
      id: typeof id === 'number' ? id : -1,
      name: typeof ph.name === 'string' ? ph.name : '',
      prompt_template: typeof ph.prompt_template === 'string' ? ph.prompt_template : '',
      success_criteria: scOut,
    };
    if (typeof ph.description === 'string') phase.description = ph.description;
    if (deps !== undefined) phase.deps = deps;
    if (max_minutes !== undefined) phase.max_minutes = max_minutes;
    phases.push(phase);
  });

  // Cross-phase: deps must reference earlier phase ids; ids should be 1..N.
  const sortedIds = [...seenIds].sort((a, b) => a - b);
  for (let i = 0; i < sortedIds.length; i++) {
    if (sortedIds[i] !== i + 1) {
      errors.push(`phases ids should be sequential 1..${sortedIds.length}; got ${sortedIds.join(',')}`);
      break;
    }
  }
  for (const ph of phases) {
    if (!ph.deps) continue;
    for (const d of ph.deps) {
      if (!seenIds.has(d)) {
        errors.push(`phases[${ph.id}].deps: references unknown phase id ${d}`);
      } else if (d >= ph.id) {
        errors.push(`phases[${ph.id}].deps: ${d} must reference a strictly-earlier phase`);
      }
    }
  }

  // Optional chain_config / defaults pass-through (lightly validated)
  const out: ScaffolderChainSpec = { phases };
  if (obj.defaults !== undefined) {
    if (typeof obj.defaults !== 'object' || obj.defaults === null) {
      errors.push('defaults: must be an object');
    } else {
      out.defaults = obj.defaults as NonNullable<ScaffolderChainSpec['defaults']>;
    }
  }
  if (obj.chain_config !== undefined) {
    if (typeof obj.chain_config !== 'object' || obj.chain_config === null) {
      errors.push('chain_config: must be an object');
    } else {
      out.chain_config = obj.chain_config as NonNullable<ScaffolderChainSpec['chain_config']>;
    }
  }

  if (errors.length > 0) throw new SchemaError(errors);
  return out;
}

/** Render a ScaffolderChainSpec back to YAML. Deterministic key order. */
export function specToYaml(spec: ScaffolderChainSpec): string {
  // js-yaml dump preserves object key order. We hand-build the object so the
  // emitted YAML reads top-down: defaults → chain_config → phases.
  const root: Record<string, unknown> = {};
  if (spec.defaults) root.defaults = spec.defaults;
  if (spec.chain_config) root.chain_config = spec.chain_config;
  root.phases = spec.phases.map((p) => {
    const r: Record<string, unknown> = { id: p.id, name: p.name };
    if (p.description) r.description = p.description;
    if (p.deps) r.deps = p.deps;
    if (p.max_minutes !== undefined) r.max_minutes = p.max_minutes;
    r.success_criteria = p.success_criteria;
    r.prompt_template = p.prompt_template;
    return r;
  });
  return yaml.dump(root, { lineWidth: 100, noRefs: true });
}
