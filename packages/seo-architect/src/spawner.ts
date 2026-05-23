/**
 * Spawner abstraction — wraps `@chiefaia/claude-spawner`'s `spawnClaude`
 * behind a function-typed seam so the architect's `run()` can be tested
 * with a deterministic fake.
 *
 * The real spawner lives in `@chiefaia/claude-spawner` (subscription-only,
 * never sets ANTHROPIC_API_KEY). Mirrors the Frontend Architect template
 * verbatim — this file should be identical across all 17 architects.
 */

import {
  spawnClaude,
  parseClaudeJsonEnvelope,
  type SpawnClaudeResult
} from '@chiefaia/claude-spawner';

import type { ArchitectBudget } from './types.js';

/**
 * Inputs to a single spawn — system prompt + user prompt + budget.
 */
export interface ArchitectSpawnInput {
  systemPrompt: string;
  userPrompt: string;
  budget: ArchitectBudget;
}

/**
 * Output of a single spawn — the raw assistant text plus telemetry.
 * Parsing into a structured `ArchitectOutput` happens in `run()`, not
 * here, so the spawner stays generic across architects.
 */
export interface ArchitectSpawnOutput {
  /** The assistant's final message — expected to be a JSON-shaped string. */
  text: string;
  /** Best-effort token + cost telemetry from the envelope. */
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
  wallClockMs: number;
  /** Echoed back from input. */
  model: string;
  /** True iff the spawn succeeded and the envelope was parsed cleanly. */
  ok: boolean;
  /** Diagnostic when `ok=false`. */
  diagnostic: string | null;
}

/**
 * The seam every architect's `run()` consumes. Inject a fake in tests.
 */
export type ArchitectSpawnerFn = (input: ArchitectSpawnInput) => Promise<ArchitectSpawnOutput>;

/**
 * Map the architect-budget model preference to the `claude` binary's
 * `--model` flag value. The mapping mirrors what local-llm-router uses
 * elsewhere in the monorepo.
 */
export function modelTagFor(preferred: 'haiku' | 'sonnet' | 'opus'): string {
  switch (preferred) {
    case 'haiku':
      return 'claude-haiku-4-5';
    case 'opus':
      return 'claude-opus-4-6';
    case 'sonnet':
    default:
      return 'claude-sonnet-4-6';
  }
}

/**
 * Build the canonical user-message body. The system prompt is fed as
 * the first user-message paragraph (rather than via `claude`'s
 * `--system` flag) — keeps the spawner surface narrow and lets the
 * test seam see everything in one string.
 */
export function buildSpawnPrompt(input: ArchitectSpawnInput): string {
  return [
    '# System briefing',
    '',
    input.systemPrompt,
    '',
    '# Task input',
    '',
    input.userPrompt,
    '',
    '# Response contract',
    '',
    'Respond with a SINGLE JSON object matching the schema in the system briefing.',
    'No prose outside the JSON. No code fences. Just the JSON.'
  ].join('\n');
}

/**
 * Wire the real `spawnClaude` into an `ArchitectSpawnerFn`. Used by
 * `SeoArchitect` when no spawner is injected.
 */
export function createDefaultSpawner(): ArchitectSpawnerFn {
  return async function defaultSpawner(input: ArchitectSpawnInput): Promise<ArchitectSpawnOutput> {
    const prompt = buildSpawnPrompt(input);
    const t0 = Date.now();
    const result: SpawnClaudeResult = await spawnClaude({
      prompt,
      options: {
        model: modelTagFor(input.budget.preferredModel),
        timeoutMs: input.budget.maxWallClockMs,
        outputFormat: 'json'
      }
    });
    const wallClockMs = Date.now() - t0;

    if (!result.ok) {
      return {
        text: '',
        inputTokens: 0,
        outputTokens: 0,
        usdCost: 0,
        wallClockMs,
        model: modelTagFor(input.budget.preferredModel),
        ok: false,
        diagnostic: result.diagnostic ?? 'spawnClaude returned ok=false'
      };
    }

    const parsed = parseClaudeJsonEnvelope(result.stdout);
    if (!parsed.ok) {
      return {
        text: '',
        inputTokens: 0,
        outputTokens: 0,
        usdCost: 0,
        wallClockMs,
        model: modelTagFor(input.budget.preferredModel),
        ok: false,
        diagnostic: parsed.diagnostic
      };
    }

    return {
      text: parsed.text,
      inputTokens: parsed.envelope.usage?.input_tokens ?? 0,
      outputTokens: parsed.envelope.usage?.output_tokens ?? 0,
      usdCost: parsed.envelope.total_cost_usd ?? 0,
      wallClockMs,
      model: modelTagFor(input.budget.preferredModel),
      ok: true,
      diagnostic: null
    };
  };
}
