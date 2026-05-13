/**
 * Verifier prompt builder.
 *
 * Loads templates/verifier_prompt.md and substitutes the {placeholder}
 * tokens with the spec material the slot-manager hands the verifier
 * spawn. Pure, stdlib-only; no IO beyond reading the template files.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { VerifierSpawnInputs } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const TEMPLATE_PATH = join(HERE, '..', 'templates', 'verifier_prompt.md');
const SCHEMA_PATH = join(HERE, '..', 'templates', 'verifier_verdict_schema.json');

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;

export function loadVerifierTemplate(): string {
  const raw = readFileSync(TEMPLATE_PATH, 'utf8');
  return raw.replace(FRONTMATTER_RE, '');
}

export function loadVerdictSchema(): Record<string, unknown> {
  const raw = readFileSync(SCHEMA_PATH, 'utf8');
  return JSON.parse(raw);
}

function formatAcBlock(items: VerifierSpawnInputs['spec']['acceptanceCriteria']): string {
  if (!items || items.length === 0) return '  (none — verdict will be fail-spec)';
  const lines: string[] = [];
  items.forEach((ac, i) => {
    const text = typeof ac === 'string' ? ac : (ac.text ?? ac.ac ?? JSON.stringify(ac));
    lines.push(`  ${i + 1}. ${text}`);
  });
  return lines.join('\n');
}

function formatFileBlock(files: string[]): string {
  if (!files || files.length === 0) return '  (none — implementor may have legitimately changed nothing)';
  return files.map((f) => `  - ${f}`).join('\n');
}

function formatTestsBlock(tests: VerifierSpawnInputs['spec']['testsRequired']): string {
  if (!tests || tests.length === 0) return '  (none required by spec)';
  return tests
    .map((t) => {
      if (typeof t === 'string') return `  - ${t}`;
      const name = t.name ?? t.path ?? JSON.stringify(t);
      const kind = t.kind ?? 'test';
      return `  - [${kind}] ${name}`;
    })
    .join('\n');
}

function formatBullets(items: string[], emptyText: string): string {
  if (!items || items.length === 0) return `  ${emptyText}`;
  return items.map((x) => `  - ${x}`).join('\n');
}

/** Build the verbatim prompt the spawner hands to `claude --print`. */
export function buildVerifierPrompt(input: VerifierSpawnInputs): string {
  const tmpl = loadVerifierTemplate();
  const schema = loadVerdictSchema();

  const subs: Record<string, string> = {
    '{verifier_spawn_id}': input.verifierSpawnId,
    '{implementing_spawn_id}': input.implementingSpawnId,
    '{node_id}': input.taskId,
    '{pr_url}': input.prUrl,
    '{pr_branch}': input.prBranch,
    '{pr_base_sha}': input.prBaseSha,
    '{pr_head_sha}': input.prHeadSha,
    '{verifier_worktree}': input.verifierWorktree,
    '{routing_class}': input.routingClass,
    '{blocking}': input.routingClass === 'autonomous-loop' ? 'true' : 'false',
    '{title}': input.spec.title,
    '{work_directive}': input.spec.workDirective,
    '{parent_context}': input.spec.parentContext || '(root)',
    '{tech_context}': formatBullets(input.spec.techContext, '(no EA tech_context resolved)'),
    '{architectural_constraints}': formatBullets(input.spec.architecturalConstraints, '(none declared)'),
    '{dod_required_stages}': formatBullets(input.spec.dodRequiredStages, '(none — falls back to [Implement, Unit-test])'),
    '{acceptance_criteria_block}': formatAcBlock(input.spec.acceptanceCriteria),
    '{file_scope_block}': formatFileBlock(input.spec.fileScope),
    '{tests_required_block}': formatTestsBlock(input.spec.testsRequired),
    '{tests_filter_expr}': input.spec.testsFilterExpr || '<scope/path glob>',
    '{implementor_claim_json_pretty}': JSON.stringify(input.implementorClaim, null, 2),
    '{verdict_schema_block}': JSON.stringify(schema, null, 2)
  };

  let out = tmpl;
  for (const [k, v] of Object.entries(subs)) {
    out = out.split(k).join(v);
  }
  return out;
}
