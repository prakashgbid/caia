import {
  parseClaudeJsonEnvelope,
  spawnClaude,
  type SpawnClaudeResult
} from '@chiefaia/claude-spawner';

import type { AuthorBudget } from './types.js';

export interface AuthorSpawnInput {
  systemPrompt: string;
  userPrompt: string;
  budget: AuthorBudget;
}

export interface AuthorSpawnOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
  wallClockMs: number;
  model: string;
  ok: boolean;
  diagnostic: string | null;
}

export type AuthorSpawnerFn = (input: AuthorSpawnInput) => Promise<AuthorSpawnOutput>;

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

export function buildSpawnPrompt(input: AuthorSpawnInput): string {
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

export function createDefaultSpawner(): AuthorSpawnerFn {
  return async function defaultSpawner(input: AuthorSpawnInput): Promise<AuthorSpawnOutput> {
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
      return { text: '', inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs, model: modelTagFor(input.budget.preferredModel), ok: false, diagnostic: result.diagnostic ?? 'spawnClaude returned ok=false' };
    }
    const parsed = parseClaudeJsonEnvelope(result.stdout);
    if (!parsed.ok) {
      return { text: '', inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs, model: modelTagFor(input.budget.preferredModel), ok: false, diagnostic: parsed.diagnostic };
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
