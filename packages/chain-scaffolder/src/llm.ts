import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScaffolderSpec, SchemaError } from './schema.js';
import { gatherContext, type GatherOptions } from './context.js';
import { resolveProvider, type ProviderResolveOpts } from './providers.js';
import type {
  LooseBacklogItem,
  LlmProvider,
  LlmScaffoldResult,
  ScaffolderChainSpec,
} from './types.js';

/**
 * Options for `scaffoldFromLlm`. Mirrors fields from {@link ProviderResolveOpts}
 * and {@link GatherOptions}; we hand-merge rather than `extends` because both
 * parents declare `routerBaseUrl` with slightly different nullability (provider
 * options forbid null; context options allow null to disable). Hand-merging
 * keeps strict-mode happy.
 */
export interface ScaffoldFromLlmOptions {
  // ── provider resolution ────────────────────────────────────────────
  provider?: ProviderResolveOpts['provider'];
  claudeBin?: ProviderResolveOpts['claudeBin'];
  claudeModel?: ProviderResolveOpts['claudeModel'];
  localTaskType?: ProviderResolveOpts['localTaskType'];
  fixtureResponse?: ProviderResolveOpts['fixtureResponse'];
  /** Pre-loaded provider (skips resolveProvider). For tests. */
  providerInstance?: LlmProvider;
  // ── context gathering ───────────────────────────────────────────────
  cwd?: GatherOptions['cwd'];
  contextFiles?: GatherOptions['contextFiles'];
  maxFileBytes?: GatherOptions['maxFileBytes'];
  maxTotalBytes?: GatherOptions['maxTotalBytes'];
  /** Override router base URL. Pass null to disable semantic search; pass
   *  undefined (or omit) for the default :7411 probe. */
  routerBaseUrl?: string | null;
  grepImpl?: GatherOptions['grepImpl'];
  readFileImpl?: GatherOptions['readFileImpl'];
  semanticSearchImpl?: GatherOptions['semanticSearchImpl'];
  // ── scaffolder ──────────────────────────────────────────────────────
  /** Path to the few-shot example YAML the LLM should mimic.
   *  Defaults to the bundled sps_router_critical_fixes_phases.yaml. */
  fewShotExamplePath?: string;
  /** Override report directory token used in success_criteria.output_file. */
  reportsDir?: string;
  /** Today date string injected into the prompt + report path. */
  today?: string;
}

const FALLBACK_EXAMPLE = `defaults:
  max_retries: 2
  heartbeat_interval_sec: 60

chain_config:
  alert_channels: [handoff, inbox, audit]
  max_concurrent: 1
  acceptance_enforce_default: warn

phases:
  - id: 1
    name: example_phase
    description: "One-line description of what this phase does and why."
    deps: []
    max_minutes: 120
    success_criteria:
      output_file: "~/Documents/projects/reports/example_2026-05-16.md"
      min_bytes: 800
      grep_match: "implemented|landed"
      requires_merged_pr: true
    prompt_template: |
      Phase 1 — Concrete instructions for the worker.

      ## Background
      Why this work matters; what the failure mode looks like today.

      ## Implementation
      1. File-level steps; cite paths under caia/packages/...
      2. Wire-in points + the exact symbol names.
      3. Unit tests covering the regression.

      ## PR
      Branch \`feat/<id>-2026-05-16\`. Open via caia-pr-create-safe, drive to MERGED.

      ## Report
      \`~/Documents/projects/reports/<id>_2026-05-16.md\`.
      gate-mark-done.sh + caia-chain mark-done 1.
`;

const SYSTEM_PROMPT = `You are the CAIA chain-scaffolder. Your job is to turn a loose backlog item (title + 1–2 line description + some gathered codebase context) into a fully-formed phases YAML for the caia-chain runner. The output drives an autonomous worker, so it must be precise, file-cite-able, and self-contained.

OUTPUT CONTRACT — must be a single YAML document, NOTHING ELSE. No prose before, no commentary after. Optionally wrap in a single \`\`\`yaml fence.

The YAML must have this shape:

defaults:                  # optional
  max_retries: <int>
  heartbeat_interval_sec: 60
chain_config:              # optional but recommended
  alert_channels: [handoff, inbox, audit]
  max_concurrent: 1
  acceptance_enforce_default: warn
  machine: m3              # m3 | m1 | stolution — pick from item.machine, else m3
phases:
  - id: 1                  # ids are 1..N sequential
    name: snake_case_name
    description: "What this phase does."
    deps: []               # ids of earlier phases that must finish first
    max_minutes: 120
    success_criteria:
      output_file: "~/Documents/projects/reports/<chain-id>_p1_<YYYY-MM-DD>.md"
      min_bytes: 800
      grep_match: "<word>|<other>"
      requires_merged_pr: true
    prompt_template: |
      Phase 1 — Concrete title.

      ## Background … why this work, what's broken now.
      ## Implementation … file-level steps with caia/packages/... paths.
      ## PR … branch name, caia-pr-create-safe, drive to MERGED.
      ## Report … the success_criteria.output_file path, gate-mark-done.sh + caia-chain mark-done <id>.

RULES
- phase_count: choose 1–3 phases. Use 1 if the work is a single landable PR, 2 if there's a natural sequence (impl → integrate), 3 only if there are real handoff seams (impl → cost-controls → integrate). Never invent ceremony.
- Every phase MUST have prompt_template AND success_criteria.output_file.
- success_criteria.output_file under ~/Documents/projects/reports/, date-stamped.
- requires_merged_pr defaults to true when the phase touches code.
- deps reference earlier ids only; first phase has deps: [] (or omitted).
- max_minutes: 60–180 typical. Default 120.
- The prompt_template is the entire prompt the autonomous worker will read — include enough context (file paths, current bug, what good looks like) that the worker doesn't need to re-discover the problem.
- Reference specific file paths from the gathered context whenever you can.
- Do not include OS-specific commands the operator must run. The worker is autonomous.

Below is a representative example of well-formed output. Copy its STYLE, not its content.
`;

/**
 * Scaffold a chain from a loose backlog item via an LLM.
 *
 * Flow:
 *   1. Resolve the provider (auto/claude/local).
 *   2. Load the few-shot example.
 *   3. Gather codebase context (files, grep, semantic).
 *   4. Build the system+user prompt; call the provider.
 *   5. Parse + validate the response. On schema error, retry ONCE with the
 *      errors fed back into the user message.
 *   6. Return the validated spec.
 */
export async function scaffoldFromLlm(
  item: LooseBacklogItem,
  opts: ScaffoldFromLlmOptions = {},
): Promise<LlmScaffoldResult> {
  validateLooseItem(item);

  const providerOpts: ProviderResolveOpts = {};
  if (opts.provider !== undefined) providerOpts.provider = opts.provider;
  if (opts.claudeBin !== undefined) providerOpts.claudeBin = opts.claudeBin;
  if (opts.claudeModel !== undefined) providerOpts.claudeModel = opts.claudeModel;
  if (opts.localTaskType !== undefined) providerOpts.localTaskType = opts.localTaskType;
  if (opts.fixtureResponse !== undefined) providerOpts.fixtureResponse = opts.fixtureResponse;
  if (opts.routerBaseUrl !== undefined && opts.routerBaseUrl !== null) {
    providerOpts.routerBaseUrl = opts.routerBaseUrl;
  }
  const provider = opts.providerInstance ?? (await resolveProvider(providerOpts));

  const gatherOpts: GatherOptions = {};
  if (opts.cwd !== undefined) gatherOpts.cwd = opts.cwd;
  if (opts.contextFiles !== undefined) gatherOpts.contextFiles = opts.contextFiles;
  if (opts.maxFileBytes !== undefined) gatherOpts.maxFileBytes = opts.maxFileBytes;
  if (opts.maxTotalBytes !== undefined) gatherOpts.maxTotalBytes = opts.maxTotalBytes;
  if (opts.routerBaseUrl !== undefined) gatherOpts.routerBaseUrl = opts.routerBaseUrl;
  if (opts.grepImpl !== undefined) gatherOpts.grepImpl = opts.grepImpl;
  if (opts.readFileImpl !== undefined) gatherOpts.readFileImpl = opts.readFileImpl;
  if (opts.semanticSearchImpl !== undefined) gatherOpts.semanticSearchImpl = opts.semanticSearchImpl;

  const fewShot = await loadFewShot(opts.fewShotExamplePath);
  const ctx = await gatherContext(item, gatherOpts);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  const userMessage = buildUserMessage(item, ctx, today);
  const system = `${SYSTEM_PROMPT}\n\nEXAMPLE (style reference only):\n\n${fewShot}\n`;

  const attempts: LlmScaffoldResult['attempts'] = [];

  // Attempt 1
  const r1 = await provider.complete(system, userMessage, { maxTokens: 4000, temperature: 0.1 });
  try {
    const spec = parseScaffolderSpec(r1.raw);
    finaliseSpec(spec, item);
    attempts.push({ n: 1, ok: true });
    return { chain_id: item.id, spec, raw: r1, attempts };
  } catch (e) {
    if (!(e instanceof SchemaError)) throw e;
    attempts.push({ n: 1, ok: false, errors: e.errors });

    // Attempt 2 — feed the errors back into the user message
    const correctionMsg =
      userMessage +
      `\n\n---\n\nYour previous output failed schema validation with these errors:\n` +
      e.errors.map((err) => `  • ${err}`).join('\n') +
      `\n\nReturn ONLY the corrected YAML — no prose, no apology, no commentary. Same shape as the example.`;

    const r2 = await provider.complete(system, correctionMsg, { maxTokens: 4000, temperature: 0.05 });
    try {
      const spec = parseScaffolderSpec(r2.raw);
      finaliseSpec(spec, item);
      attempts.push({ n: 2, ok: true });
      return { chain_id: item.id, spec, raw: r2, attempts };
    } catch (e2) {
      if (e2 instanceof SchemaError) {
        attempts.push({ n: 2, ok: false, errors: e2.errors });
        throw new SchemaError([
          `LLM scaffolder failed after retry. First attempt: ${e.errors.length} error(s). Retry: ${e2.errors.length} error(s).`,
          ...e2.errors.map((s) => `retry: ${s}`),
        ]);
      }
      throw e2;
    }
  }
}

/** Inject derived chain-id / machine into the spec if the LLM omitted them. */
function finaliseSpec(spec: ScaffolderChainSpec, item: LooseBacklogItem): void {
  spec.chain_config ??= {};
  if (!spec.chain_config.machine) {
    spec.chain_config.machine = item.machine ?? 'm3';
  }
  if (!spec.chain_config.acceptance_enforce_default) {
    spec.chain_config.acceptance_enforce_default = 'warn';
  }
  if (!spec.chain_config.alert_channels) {
    spec.chain_config.alert_channels = ['handoff', 'inbox', 'audit'];
  }
  if (spec.chain_config.max_concurrent === undefined) {
    spec.chain_config.max_concurrent = 1;
  }
  spec.defaults ??= {};
  if (spec.defaults.max_retries === undefined) spec.defaults.max_retries = 2;
  if (spec.defaults.heartbeat_interval_sec === undefined) spec.defaults.heartbeat_interval_sec = 60;
}

function validateLooseItem(item: LooseBacklogItem): void {
  if (!item.id || typeof item.id !== 'string') {
    throw new Error('LooseBacklogItem.id is required (kebab-case)');
  }
  if (!/^[a-z][a-z0-9-]{2,}$/.test(item.id)) {
    throw new Error(`LooseBacklogItem.id must match /^[a-z][a-z0-9-]{2,}$/, got '${item.id}'`);
  }
  if (!item.title || typeof item.title !== 'string' || item.title.trim().length < 4) {
    throw new Error('LooseBacklogItem.title is required (>=4 chars)');
  }
  if (!item.description || typeof item.description !== 'string' || item.description.trim().length < 10) {
    throw new Error('LooseBacklogItem.description is required (>=10 chars)');
  }
}

function buildUserMessage(item: LooseBacklogItem, ctx: Awaited<ReturnType<typeof gatherContext>>, today: string): string {
  const lines: string[] = [];
  lines.push('# Backlog item');
  lines.push(`id: ${item.id}`);
  lines.push(`title: ${item.title}`);
  lines.push(`description: ${item.description}`);
  if (item.machine) lines.push(`machine: ${item.machine}`);
  if (item.deps?.length) lines.push(`deps_on_chains: ${item.deps.join(', ')}`);
  if (item.file_paths?.length) {
    lines.push(`hinted_file_paths:`);
    for (const fp of item.file_paths) lines.push(`  - ${fp}`);
  }
  lines.push('');
  lines.push(`Today: ${today}`);
  lines.push(`Suggested report path stem: ~/Documents/projects/reports/${item.id.replace(/-/g, '_')}_pN_${today}.md`);
  lines.push('');

  lines.push('# Gathered context');
  lines.push(ctx.summary);
  lines.push('');

  if (ctx.files.length > 0) {
    lines.push('## File snippets');
    for (const f of ctx.files) {
      lines.push(`### ${f.path}${f.truncated ? ' (truncated)' : ''}`);
      lines.push('```');
      lines.push(f.snippet);
      lines.push('```');
    }
    lines.push('');
  }
  if (ctx.grep_hits.length > 0) {
    lines.push('## Grep hits');
    for (const g of ctx.grep_hits) {
      lines.push(`### pattern: ${g.pattern}`);
      lines.push('```');
      for (const l of g.lines) lines.push(l);
      lines.push('```');
    }
    lines.push('');
  }
  if (ctx.semantic_hits.length > 0) {
    lines.push('## Semantic search hits (local-llm-router)');
    for (const s of ctx.semantic_hits) {
      lines.push(`- ${s.path}${s.score !== undefined ? ` (score=${s.score.toFixed(3)})` : ''}`);
      if (s.snippet) lines.push(`  ${s.snippet.slice(0, 200)}`);
    }
    lines.push('');
  }

  lines.push('# Task');
  lines.push(
    'Emit the phases YAML for this item. Follow the OUTPUT CONTRACT in the system prompt. ' +
      'Cite paths from the gathered context whenever you can. Keep phase_count modest (1–3).',
  );
  return lines.join('\n');
}

async function loadFewShot(explicitPath?: string): Promise<string> {
  const candidates: string[] = [];
  if (explicitPath) candidates.push(explicitPath);
  // Operator-side canonical location
  candidates.push(resolve(process.env.HOME ?? '~', 'Documents/projects/agent-memory/sps_router_critical_fixes_phases.yaml'));
  // Bundled fixture (for tests + zero-config scaffolds)
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(here, '../tests/fixtures/example_chain.yaml'));
    candidates.push(resolve(here, '../__tests__/fixtures/example_chain.yaml'));
    // When running from dist/, fixtures live one level up
    candidates.push(join(here, '..', 'tests', 'fixtures', 'example_chain.yaml'));
  } catch {
    /* import.meta.url unavailable in some test runners — skip */
  }
  for (const c of candidates) {
    try {
      return await readFile(c, 'utf8');
    } catch {
      /* try next */
    }
  }
  return FALLBACK_EXAMPLE;
}
