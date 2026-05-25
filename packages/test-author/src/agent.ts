import { buildTestAuthorSystemPrompt } from './system-prompt.js';
import { createDefaultSpawner, type AuthorSpawnerFn } from './spawner.js';
import { validateAuthorOutput } from './validation.js';
import type { AuthorBudget, AuthorInput, AuthorOutput, AuthorSpend, TestDesign } from './types.js';

export const AUTHOR_NAME = 'test-author' as const;
const UPSTREAM_DEPENDENCIES = ['testing', 'frontend', 'backend', 'database'] as const;

export const DEFAULT_BUDGET: AuthorBudget = {
  maxInputTokens: 60000,
  maxOutputTokens: 8000,
  maxWallClockMs: 90000,
  preferredModel: 'sonnet',
  hardCostCeilingUsd: 0.5
};

export interface TestAuthorAgentConfig {
  spawner?: AuthorSpawnerFn;
  clock?: () => number;
}

function emptyDesign(now: number): TestDesign {
  return {
    designedBy: AUTHOR_NAME,
    designedAt: now,
    totalCases: 0,
    categoryCounts: { happy: 0, edge: 0, error: 0, accessibility: 0, security: 0, performance: 0, visual: 0 },
    layerCounts: { unit: 0, integration: 0, e2e: 0, visual: 0, accessibility: 0 }
  };
}

export class TestAuthorAgent {
  readonly name = AUTHOR_NAME;
  private readonly spawner: AuthorSpawnerFn;
  private readonly clock: () => number;

  constructor(config: TestAuthorAgentConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
    this.clock = config.clock ?? Date.now;
  }

  systemPrompt(): string {
    return buildTestAuthorSystemPrompt();
  }

  buildUserPrompt(input: AuthorInput): string {
    const projection = {
      ticket: input.ticket,
      composedArchitecture: input.composedArchitecture,
      acceptanceCriteria: input.acceptanceCriteria ?? input.ticket.acceptance_criteria ?? [],
      budget: { model: (input.budget ?? DEFAULT_BUDGET).preferredModel, maxOutputTokens: (input.budget ?? DEFAULT_BUDGET).maxOutputTokens },
      reviewerFeedback: input.reviewerFeedback ?? null
    };
    return JSON.stringify(projection, null, 2);
  }

  async design(input: AuthorInput): Promise<AuthorOutput> {
    const budget = input.budget ?? DEFAULT_BUDGET;
    const userPrompt = this.buildUserPrompt(input);
    const acLength = (input.acceptanceCriteria ?? input.ticket.acceptance_criteria ?? []).length;
    const spawn = await this.spawner({ systemPrompt: this.systemPrompt(), userPrompt, budget });
    const spend: AuthorSpend = {
      inputTokens: spawn.inputTokens,
      outputTokens: spawn.outputTokens,
      usdCost: spawn.usdCost,
      wallClockMs: spawn.wallClockMs,
      model: spawn.model
    };
    if (!spawn.ok) {
      return {
        agentName: AUTHOR_NAME,
        testCases: [],
        testDesign: emptyDesign(this.clock()),
        confidence: 0,
        notes: 'Spawn failed before any test cases were produced.',
        dependencies: Array.from(UPSTREAM_DEPENDENCIES),
        risks: [`spawn failure: ${spawn.diagnostic ?? 'unknown'}`],
        toolCalls: [],
        spend,
        status: 'failed',
        failureReason: spawn.diagnostic ?? 'spawner returned ok=false'
      };
    }
    const validation = validateAuthorOutput(spawn.text, acLength);
    if (!validation.ok || !validation.parsed) {
      const errorSummary = validation.errors.slice(0, 5).map(e => `${e.code}${e.field ? `:${e.field}` : ''}`).join('; ');
      return {
        agentName: AUTHOR_NAME,
        testCases: [],
        testDesign: emptyDesign(this.clock()),
        confidence: 0,
        notes: `Validation failed: ${errorSummary}`,
        dependencies: Array.from(UPSTREAM_DEPENDENCIES),
        risks: validation.errors.slice(0, 5).map(e => e.message),
        toolCalls: [],
        spend,
        status: 'partial',
        failureReason: errorSummary
      };
    }
    const parsed = validation.parsed;
    return {
      ...parsed,
      agentName: AUTHOR_NAME,
      testDesign: { ...parsed.testDesign, designedBy: AUTHOR_NAME, designedAt: this.clock() },
      dependencies: ensureUpstreamDependencies(parsed.dependencies),
      spend
    };
  }
}

function ensureUpstreamDependencies(emitted: readonly string[] | undefined): readonly string[] {
  const set = new Set(emitted ?? []);
  for (const d of UPSTREAM_DEPENDENCIES) set.add(d);
  return Array.from(set);
}
