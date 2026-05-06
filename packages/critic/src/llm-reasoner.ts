/**
 * LLM-reasoned tier — see DESIGN.md §5.2.
 *
 * Spawns the `claude` binary in subprocess (subscription-only path —
 * cribbed from packages/apprentice-corpus/src/distiller.ts). The prompt
 * carries:
 *   1. A short adversarial-review system prompt.
 *   2. The 18-category failure-mode taxonomy with descriptions.
 *   3. The diff hunks (capped to a configured byte budget).
 *   4. A strict JSON output schema.
 *
 * Failures (timeout, parse-error, non-zero exit) cause `ok: false` and the
 * caller drops the LLM-tier findings. Deterministic-tier findings are
 * always emitted regardless.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import type {
  AdversarialFinding,
  DiffHunk,
  FailureModeId,
  LlmReasonInput,
  LlmReasonOutput,
  LlmReasoner,
  Severity,
  TaxonomyEntry
} from './types.js';
import { ALL_FAILURE_MODES, DEFAULT_SEVERITY, SEVERITY_RANK } from './types.js';

export interface DefaultLlmReasonerOptions {
  binaryPath: string;
  modelTag: string;
  timeoutMs: number;
  /** Test seam — replaces `child_process.spawnSync`. */
  spawnFn?: (
    cmd: string,
    args: readonly string[],
    opts: { input: string; encoding: 'utf-8'; timeout: number; env: NodeJS.ProcessEnv }
  ) => SpawnSyncReturns<string>;
}

const SYSTEM_PROMPT = `You are an adversarial code reviewer for the CAIA monorepo. Your job is to assume malice or sloppiness and find concrete attack vectors / failure-modes in the changes. Do NOT comment on style. Do NOT rewrite code. Only surface what could go wrong.

For every finding, classify it into ONE of the categories listed below (use the exact id), assign a severity, point to the file/line, and include a one-line attackVector name plus a short description and concrete reproductionSteps.

Output STRICT JSON in the shape:
{"findings":[{"category":"<id>","severity":"low|medium|high|critical","file":"...","line":123,"attackVector":"...","description":"...","reproductionSteps":["..."],"suggestedMitigation":"...","excerpt":"..."}]}
No prose before or after. No markdown fences.`;

export function buildPrompt(input: LlmReasonInput): string {
  const taxonomyBlock = input.taxonomy
    .map(t => `  - ${t.id}: ${t.description}`)
    .join('\n');
  const hunksBlock = input.hunks
    .map(h => `### ${h.file} (${h.status})\n${h.header}\n${h.body}`)
    .join('\n\n');
  return `${SYSTEM_PROMPT}

## Failure-mode taxonomy
${taxonomyBlock}

## PR metadata
- prNumber: ${input.pr.prNumber}
- branch: ${input.pr.branch}
- baseBranch: ${input.pr.baseBranch}
- title: ${input.pr.title}

## Diff hunks
${hunksBlock}

## Output JSON now:`;
}

export function createDefaultLlmReasoner(opts: DefaultLlmReasonerOptions): LlmReasoner {
  const spawn = opts.spawnFn ?? spawnSync;
  return {
    async reason(input: LlmReasonInput): Promise<LlmReasonOutput> {
      const prompt = buildPrompt(input);
      const env = { ...process.env };
      delete env['ANTHROPIC_API_KEY'];
      const result = spawn(
        opts.binaryPath,
        ['--print', '--output-format', 'json', '--model', opts.modelTag],
        { input: prompt, encoding: 'utf-8', timeout: opts.timeoutMs, env }
      );
      if (result.error !== null && result.error !== undefined) {
        return {
          findings: [],
          ok: false,
          diagnostic: `claude spawn error: ${result.error.message}`
        };
      }
      if (result.status !== 0) {
        return {
          findings: [],
          ok: false,
          diagnostic: `claude exited ${result.status}: ${(result.stderr ?? '').toString().slice(0, 300)}`
        };
      }
      const stdout = (result.stdout ?? '').toString();
      return parseLlmOutput(stdout);
    }
  };
}

/** Parse the `claude --print --output-format json` envelope, then the
 * inner JSON the prompt asked for. Robust against extra whitespace and
 * leading/trailing prose (we extract the first balanced `{...}` block). */
export function parseLlmOutput(stdout: string): LlmReasonOutput {
  let outer: unknown;
  try {
    outer = JSON.parse(stdout);
  } catch (e) {
    return { findings: [], ok: false, diagnostic: `outer JSON parse: ${(e as Error).message}` };
  }
  if (
    typeof outer !== 'object'
    || outer === null
    || typeof (outer as { result?: unknown }).result !== 'string'
  ) {
    return { findings: [], ok: false, diagnostic: 'envelope missing "result" string' };
  }
  const inner = (outer as { result: string }).result;
  const block = extractFirstJsonObject(inner);
  if (block === null) {
    return { findings: [], ok: false, diagnostic: 'no JSON object in inner result' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (e) {
    return { findings: [], ok: false, diagnostic: `inner JSON parse: ${(e as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { findings: [], ok: false, diagnostic: 'inner not an object' };
  }
  const findingsRaw = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(findingsRaw)) {
    return { findings: [], ok: true };
  }
  const findings = findingsRaw
    .map(f => sanitiseLlmFinding(f))
    .filter((f): f is Omit<AdversarialFinding, 'id' | 'source' | 'detectorId'> => f !== null);
  return { findings, ok: true };
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function sanitiseLlmFinding(raw: unknown): Omit<AdversarialFinding, 'id' | 'source' | 'detectorId'> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const cat = r['category'];
  if (typeof cat !== 'string' || !ALL_FAILURE_MODES.includes(cat as FailureModeId)) return null;
  const category = cat as FailureModeId;
  const file = typeof r['file'] === 'string' ? r['file'] : '';
  if (file === '') return null;
  const line = typeof r['line'] === 'number' && Number.isFinite(r['line']) ? r['line'] : 0;
  const attackVector = typeof r['attackVector'] === 'string' && r['attackVector'].length > 0
    ? r['attackVector']
    : 'unspecified';
  const description = typeof r['description'] === 'string' ? r['description'] : '';
  if (description === '') return null;
  const repsRaw = r['reproductionSteps'];
  const reproductionSteps = Array.isArray(repsRaw)
    ? repsRaw.filter((x): x is string => typeof x === 'string')
    : [];
  const sevRaw = r['severity'];
  const severity: Severity = (sevRaw === 'low' || sevRaw === 'medium' || sevRaw === 'high' || sevRaw === 'critical')
    ? sevRaw
    : DEFAULT_SEVERITY[category];
  // Guarantee the severity isn't lower than the category default — defense
  // against a chatty LLM downplaying critical findings.
  const finalSev: Severity = SEVERITY_RANK[severity] >= SEVERITY_RANK[DEFAULT_SEVERITY[category]]
    ? severity
    : DEFAULT_SEVERITY[category];
  const excerptRaw = typeof r['excerpt'] === 'string' ? r['excerpt'].slice(0, 200) : '';
  const mitigation = typeof r['suggestedMitigation'] === 'string' ? r['suggestedMitigation'] : undefined;

  const out: Omit<AdversarialFinding, 'id' | 'source' | 'detectorId'> = {
    category,
    severity: finalSev,
    file,
    line,
    attackVector,
    description,
    reproductionSteps,
    excerpt: excerptRaw
  };
  if (mitigation !== undefined) {
    out.suggestedMitigation = mitigation;
  }
  return out;
}

/** Test-only no-op reasoner — returns an empty findings list. Default for
 * unit tests so they never spawn the real binary. */
export const noopLlmReasoner: LlmReasoner = {
  async reason(_input: LlmReasonInput): Promise<LlmReasonOutput> {
    return { findings: [], ok: true };
  }
};

/** Helper for tests — verify the prompt mentions every taxonomy entry. */
export function buildPromptDebug(taxonomy: readonly TaxonomyEntry[], hunks: readonly DiffHunk[]): string {
  return buildPrompt({
    taxonomy,
    hunks,
    pr: { prNumber: 0, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
  });
}
