/**
 * @caia/info-architect — InfoArchitectAgent.
 *
 * Drives `design(input) → IaOutput`. Uses `@chiefaia/claude-spawner`
 * with `rejectIfApiKeyPresent: true` so the binary is spawned against
 * the Claude subscription session, never against a pay-per-token API
 * key.
 *
 * Wave-1 design notes:
 *  - The LLM is called once with the system prompt built by
 *    `system-prompt.ts`; the response is expected to be a JSON object
 *    with the three top-level keys. The critic loop / multi-pass
 *    deliberation lives in Wave 2.
 *  - Callers wanting deterministic tests inject a `ScriptedLlm` to bypass
 *    the binary spawn entirely.
 *  - A "skeleton synth" fallback exists for the dispatcher's smoke
 *    path: when the LLM call returns a parseable-but-empty envelope,
 *    the agent synthesises a minimum-valid IaOutput (one page, one
 *    template, default tokens, 5-archetype components) so the FSM chain
 *    completes. Wave 2 replaces this with the proper critic loop.
 */

import {
  parseClaudeJsonEnvelope,
  spawnClaude,
  SpawnClaudeConstraintError,
  type SpawnClaudeInput,
  type SpawnClaudeResult,
} from '@chiefaia/claude-spawner';

import { InfoArchitectError } from './errors.js';
import {
  buildIaSystemPrompt,
  CREDENTIAL_ARCHETYPES,
} from './system-prompt.js';
import {
  IA_INPUT_COMPLETENESS_FLOOR,
  isIaInput,
  isIaOutput,
  type ComponentRecord,
  type ComponentsLibrary,
  type DesignSystem,
  type IaAgent,
  type IaInput,
  type IaOutput,
  type PagesCatalogue,
} from './types.js';

const DEFAULT_MODEL = 'claude-opus-4-6';
const DEFAULT_TIMEOUT_MS = 120_000;

/** Test seam — replace the spawnClaude implementation. */
export type SpawnClaudeFn = (input: SpawnClaudeInput) => Promise<SpawnClaudeResult>;

export interface InfoArchitectAgentOptions {
  /** Anthropic model tag. Default: claude-opus-4-6 (per IA spec §14.1). */
  readonly model?: string;
  /** Wall-clock timeout for the LLM call. */
  readonly timeoutMs?: number;
  /** cwd allow-list for the spawn (defaults to process.cwd()). */
  readonly cwdAllowList?: readonly string[];
  /** Inject a different spawnClaude implementation (tests). */
  readonly spawnClaudeFn?: SpawnClaudeFn;
  /**
   * Inject a scripted LLM that bypasses the spawn entirely. When set,
   * the agent calls `scriptedLlm(prompt)` and uses its returned string
   * as the LLM output JSON.
   */
  readonly scriptedLlm?: (prompt: string) => Promise<string>;
  /**
   * If true, fall back to a synthesised skeleton output when the LLM
   * returns a parseable-but-empty envelope. Default: true so the smoke
   * path always completes the FSM chain.
   */
  readonly fallbackToSkeleton?: boolean;
  /** Inject a clock for deterministic tests. */
  readonly clock?: () => Date;
}

export class InfoArchitectAgent implements IaAgent {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly cwdAllowList: readonly string[] | undefined;
  private readonly spawnClaudeFn: SpawnClaudeFn;
  private readonly scriptedLlm: ((prompt: string) => Promise<string>) | undefined;
  private readonly fallbackToSkeleton: boolean;
  private readonly clock: () => Date;

  public constructor(options: InfoArchitectAgentOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cwdAllowList = options.cwdAllowList;
    this.spawnClaudeFn = options.spawnClaudeFn ?? spawnClaude;
    this.scriptedLlm = options.scriptedLlm;
    this.fallbackToSkeleton = options.fallbackToSkeleton ?? true;
    this.clock = options.clock ?? ((): Date => new Date());
  }

  public async design(input: IaInput): Promise<IaOutput> {
    if (!isIaInput(input)) {
      throw new InfoArchitectError(
        'validation_failed',
        'IaInput failed shape validation',
      );
    }
    if (input.businessPlan.completenessScore < IA_INPUT_COMPLETENESS_FLOOR) {
      throw new InfoArchitectError(
        'validation_failed',
        `BusinessPlanV2 completeness ${String(input.businessPlan.completenessScore)} is below IA floor (${String(IA_INPUT_COMPLETENESS_FLOOR)})`,
        undefined,
        { completenessScore: input.businessPlan.completenessScore },
      );
    }

    const prompt = buildIaSystemPrompt(input, { modelHint: 'opus' });

    let rawText: string;
    if (this.scriptedLlm !== undefined) {
      rawText = await this.scriptedLlm(prompt);
    } else {
      rawText = await this.callClaude(prompt);
    }

    let parsed: IaOutput;
    try {
      parsed = this.parseLlmOutput(rawText, input);
    } catch (err) {
      if (this.fallbackToSkeleton) {
        return synthesiseSkeletonOutput(input, this.clock);
      }
      throw err;
    }

    if (!isIaOutput(parsed)) {
      if (this.fallbackToSkeleton) {
        return synthesiseSkeletonOutput(input, this.clock);
      }
      throw new InfoArchitectError(
        'schema_validation_failed',
        'LLM output failed IaOutput shape validation',
      );
    }
    return parsed;
  }

  private async callClaude(prompt: string): Promise<string> {
    const spawnInput: SpawnClaudeInput = {
      prompt,
      options: {
        model: this.model,
        timeoutMs: this.timeoutMs,
        outputFormat: 'json',
      },
      constraints: {
        rejectIfApiKeyPresent: true,
        ...(this.cwdAllowList !== undefined
          ? { cwdAllowList: this.cwdAllowList }
          : {}),
      },
    };

    let result: SpawnClaudeResult;
    try {
      result = await this.spawnClaudeFn(spawnInput);
    } catch (err) {
      if (err instanceof SpawnClaudeConstraintError) {
        if (err.code === 'api-key-present') {
          throw new InfoArchitectError(
            'subscription_only_violation',
            'API-key env var detected; IA agent is subscription-only',
            err,
          );
        }
        throw new InfoArchitectError(
          'llm_call_failed',
          `claude-spawner constraint rejected the call: ${err.message}`,
          err,
        );
      }
      throw new InfoArchitectError(
        'llm_call_failed',
        `claude-spawner threw: ${(err as Error).message}`,
        err,
      );
    }

    if (!result.ok) {
      throw new InfoArchitectError(
        'llm_call_failed',
        `claude-spawner returned ok=false: ${result.diagnostic ?? '(no diagnostic)'}`,
        undefined,
        { rc: result.rc, timedOut: result.timedOut },
      );
    }

    const parsed = parseClaudeJsonEnvelope(result.stdout);
    if (!parsed.ok) {
      throw new InfoArchitectError(
        'llm_parse_error',
        `claude envelope parse failed: ${parsed.diagnostic}`,
      );
    }
    return parsed.text;
  }

  private parseLlmOutput(rawText: string, _input: IaInput): IaOutput {
    void _input;
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      throw new InfoArchitectError('llm_parse_error', 'empty LLM output');
    }
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch (err) {
      // Try the first {...} block.
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          json = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
        } catch (innerErr) {
          throw new InfoArchitectError(
            'llm_parse_error',
            `LLM JSON parse failed: ${(innerErr as Error).message}`,
            err,
          );
        }
      } else {
        throw new InfoArchitectError(
          'llm_parse_error',
          `LLM JSON parse failed: ${(err as Error).message}`,
        );
      }
    }
    return json as IaOutput;
  }
}

// ---------------------------------------------------------------------------
// Skeleton synthesis — minimum-valid IaOutput for the smoke / fallback path.
// ---------------------------------------------------------------------------

/**
 * Produce a minimum-valid IaOutput. Used as the smoke-path fallback when
 * the LLM call returns nothing useful but the FSM still needs to advance.
 * The skeleton covers the 5 credential-UI archetypes so downstream
 * codegen has stable component identities to instantiate.
 */
export function synthesiseSkeletonOutput(
  input: IaInput,
  clock: () => Date = (): Date => new Date(),
): IaOutput {
  const now = clock().toISOString();
  const revisionId = `ia-${input.projectId}-skeleton-${now}`;

  const pagesCatalogue: PagesCatalogue = {
    catalogueVersion: '1.0.0',
    revisionId,
    parentRevisionId: input.parentRevisionId ?? null,
    createdAt: now,
    site: {
      domain: `${input.tenantContext.tenantSlug}.example`,
      name: input.tenantContext.tenantName,
      tagline: input.businessPlan.valueProposition.slice(0, 96),
      framework: 'next.js-15',
      projectType: input.projectType,
    },
    templates: [
      {
        id: 'tpl-landing',
        name: 'Landing',
        narrativeRole: 'landing',
        sectionStack: [
          {
            id: 'sec-hero',
            title: 'Hero',
            intent: 'Above-the-fold value proposition + primary CTA',
            componentRefs: ['cmp-organism-hero'],
          },
        ],
      },
    ],
    pages: [
      {
        slug: 'home',
        route: '/',
        templateRef: 'tpl-landing',
        title: input.tenantContext.tenantName,
        narrativeRole: 'landing',
        buildPath: 'direct',
      },
    ],
  };

  const designSystem: DesignSystem = {
    catalogueVersion: '1.0.0',
    revisionId,
    createdAt: now,
    tailwindConfig: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          '50': '#f5f7ff',
          '100': '#e0e7ff',
          '200': '#c7d2fe',
          '300': '#a5b4fc',
          '400': '#818cf8',
          '500': '#6366f1',
          '600': '#4f46e5',
          '700': '#4338ca',
          '800': '#3730a3',
          '900': '#312e81',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['0.75rem', '1rem'],
        sm: ['0.875rem', '1.25rem'],
        base: ['1rem', '1.5rem'],
        lg: ['1.125rem', '1.75rem'],
        xl: ['1.25rem', '1.75rem'],
        '2xl': ['1.5rem', '2rem'],
      },
      spacing: { '0': '0', '1': '0.25rem', '2': '0.5rem', '4': '1rem', '8': '2rem' },
      borderRadius: { sm: '0.125rem', md: '0.375rem', lg: '0.5rem' },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
      },
    },
    cssVariables: {
      light: { '--background': '0 0% 100%', '--foreground': '222 47% 11%' },
      dark: { '--background': '222 47% 11%', '--foreground': '210 40% 98%' },
    },
    motionTokens: {
      'duration-fast': '150ms',
      'duration-base': '250ms',
      'easing-standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
    },
  };

  const credentialComponents: ComponentRecord[] = CREDENTIAL_ARCHETYPES.map(
    (a) => ({
      id: `cmp-organism-${a.key}`,
      atomicTier: 'organism',
      displayName: `${a.title} validator`,
      shadcnComponent: null,
      tailwindClasses: 'flex flex-col gap-4 p-6 rounded-lg border bg-card',
      variants: ['default', 'compact'],
      slots: ['label', 'input', 'help', 'log'],
      states: ['resting', 'probing', 'passed', 'failed', 'deferred'],
      composedOf: ['cmp-atom-input', 'cmp-atom-button', 'cmp-molecule-status-pill'],
      usedInPages: ['home'],
      credentialArchetype: a.key,
    }),
  );

  const componentsLibrary: ComponentsLibrary = {
    catalogueVersion: '1.0.0',
    revisionId,
    createdAt: now,
    components: [
      {
        id: 'cmp-atom-input',
        atomicTier: 'atom',
        displayName: 'Input',
        shadcnComponent: 'Input',
        tailwindClasses: 'h-10 w-full rounded-md border bg-background px-3 py-2',
        variants: ['default', 'invalid'],
        slots: [],
        states: ['default', 'focus', 'disabled', 'invalid'],
        composedOf: [],
        usedInPages: ['home'],
      },
      {
        id: 'cmp-atom-button',
        atomicTier: 'atom',
        displayName: 'Button',
        shadcnComponent: 'Button',
        tailwindClasses:
          'inline-flex items-center justify-center rounded-md text-sm font-medium',
        variants: ['default', 'destructive', 'outline', 'secondary', 'ghost'],
        slots: ['leading-icon', 'trailing-icon'],
        states: ['default', 'hover', 'active', 'loading', 'disabled'],
        composedOf: [],
        usedInPages: ['home'],
      },
      {
        id: 'cmp-molecule-status-pill',
        atomicTier: 'molecule',
        displayName: 'Status pill',
        shadcnComponent: 'Badge',
        tailwindClasses:
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
        variants: ['pending', 'probing', 'passed', 'failed', 'deferred'],
        slots: ['icon', 'label'],
        states: ['resting'],
        composedOf: [],
        usedInPages: ['home'],
      },
      {
        id: 'cmp-organism-hero',
        atomicTier: 'organism',
        displayName: 'Hero',
        shadcnComponent: null,
        tailwindClasses: 'flex flex-col items-start gap-6 py-24 px-6 lg:px-12',
        variants: ['default', 'compact'],
        slots: ['eyebrow', 'headline', 'subhead', 'cta'],
        states: ['resting'],
        composedOf: ['cmp-atom-button'],
        usedInPages: ['home'],
      },
      ...credentialComponents,
    ],
  };

  return { pagesCatalogue, designSystem, componentsLibrary };
}
