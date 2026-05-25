/**
 * Policy: `subscription-only-build`
 *
 * Composite of three spec policies:
 *   - `p001-pro-subscription-only.ts` — no `ANTHROPIC_API_KEY` in env (ADR-001).
 *   - `p002-zero-dollar-budget.ts`     — no paid SaaS introduced (ADR-003).
 *   - `p009-no-token-budgets.ts`       — no `--max-tokens` / `MAX_TOKENS` (ADR-041).
 *
 * Source memory: `feedback-caia-build-uses-pro-subscription-only`.
 *
 * Rule: the build must run on the operator's Pro/Max subscription. No
 * per-token costs. No paid-API keys. No token budgets on tasks.
 *
 * Mode: `hard-fail` (all three component policies are hard-fail per spec
 * line 591/592/600).
 *
 * Detection layers:
 *
 *   1. `envKeys`         — block if `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
 *                          `MAX_TOKENS`, etc. are passed through.
 *   2. `briefMd`         — block per-token cost phrasings, `$N per million`,
 *                          paid-SaaS names from a known list.
 *   3. `estimatedCost`   — block if > 0.
 *   4. `toolList`        — block tools that imply paid APIs (e.g. raw
 *                          `anthropic-api`, `openai-api`).
 */

import type {
  DispatchContext,
  Policy,
  PolicyEvidence,
  PolicyVerdict
} from '../types.js';

/** Env-var names that indicate paid-API usage. */
const PAID_ENV_PATTERNS: ReadonlyArray<RegExp> = [
  /^ANTHROPIC_API_KEY$/,
  /^OPENAI_API_KEY$/,
  /^GROQ_API_KEY$/,
  /^MISTRAL_API_KEY$/,
  /^COHERE_API_KEY$/,
  /^MAX_TOKENS$/,
  /_API_KEY$/i // catch-all suffix
];

/** Tool ids that imply paid-API usage (not on Pro/Max subscription). */
const PAID_TOOL_PATTERNS: ReadonlyArray<RegExp> = [
  /^anthropic-api$/i,
  /^openai-api$/i,
  /^paid-api/i,
  /-billable$/i
];

/**
 * Known paid-SaaS / per-token-cost phrasings to flag in the brief. Match is
 * case-insensitive; we exclude clearly internal references like "Anthropic
 * Pro subscription" (positive phrasing).
 */
const PAID_BRIEF_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\$\s*\d+(?:\.\d+)?\s*(?:per|\/)\s*(?:million|m|k|thousand|request|token|call)/gi,
    label: 'per-token / per-call cost'
  },
  {
    pattern: /\bbudget\s*[:=]\s*\$\d/gi,
    label: 'explicit dollar budget'
  },
  {
    pattern: /\bmax[_\s\-]?tokens?\s*[:=]/gi,
    label: 'max-tokens budget'
  },
  {
    pattern: /\bcost[s]?\s*(?:about|approximately|roughly)?\s*\$\d/gi,
    label: 'dollar-cost estimate'
  },
  {
    pattern: /\bpay[\s\-]?per[\s\-]?(?:token|call|request|use)\b/gi,
    label: 'pay-per-use phrasing'
  },
  {
    pattern: /\b(?:upgrade|sign\s*up|subscribe)\s+to\s+(?:a\s+)?(?:paid|premium|enterprise|new)\s+(?:plan|tier|saas|service)\b/gi,
    label: 'paid SaaS subscription'
  }
];

/** Positive allowlist — phrases that match a paid-pattern but are fine. */
const SAFE_PHRASE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:claude\s+)?pro\s+(?:subscription|plan|tier|max)\b/gi,
  /\bsubscription[\s\-]only\b/gi,
  /\b\$0\b/gi,
  /\bzero[\s\-]?dollar\b/gi
];

function isSafePhrase(line: string): boolean {
  return SAFE_PHRASE_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(line);
  });
}

export function findPaidEnvKeys(
  envKeys: ReadonlyArray<string> | undefined
): ReadonlyArray<PolicyEvidence> {
  if (!envKeys) return [];
  const out: PolicyEvidence[] = [];
  for (const key of envKeys) {
    if (PAID_ENV_PATTERNS.some((p) => p.test(key))) {
      out.push({ source: 'envKeys', snippet: key });
    }
  }
  return out;
}

export function findPaidTools(
  toolList: ReadonlyArray<string>
): ReadonlyArray<PolicyEvidence> {
  const out: PolicyEvidence[] = [];
  for (const tool of toolList) {
    if (PAID_TOOL_PATTERNS.some((p) => p.test(tool))) {
      out.push({ source: 'toolList', snippet: tool });
    }
  }
  return out;
}

export function findPaidBriefPhrasings(
  briefMd: string
): ReadonlyArray<PolicyEvidence> {
  const evidence: PolicyEvidence[] = [];
  const lines = briefMd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (isSafePhrase(line)) continue;
    for (const { pattern } of PAID_BRIEF_PATTERNS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(line)) !== null) {
        evidence.push({
          source: 'brief',
          line: i + 1,
          snippet: line.length > 200 ? `${line.slice(0, 199)}…` : line
        });
        if (evidence.length >= 20) return evidence;
      }
    }
  }
  return evidence;
}

export const subscriptionOnlyBuildPolicy: Policy = {
  id: 'subscription-only-build',
  description:
    'Build runs on the Pro/Max subscription only. No ANTHROPIC_API_KEY / OPENAI_API_KEY in env. No paid SaaS. No token budgets. No per-call cost references. Source: ADR-001 / ADR-003 / ADR-041 / feedback-caia-build-uses-pro-subscription-only.',
  defaultMode: 'hard-fail',
  async check(ctx: DispatchContext): Promise<PolicyVerdict> {
    const envEvidence = findPaidEnvKeys(ctx.envKeys);
    const toolEvidence = findPaidTools(ctx.toolList);
    const briefEvidence = findPaidBriefPhrasings(ctx.briefMd);
    const costEvidence: PolicyEvidence[] =
      ctx.estimatedCost > 0
        ? [
            {
              source: 'estimatedCost',
              snippet: `$${ctx.estimatedCost.toFixed(4)}`
            }
          ]
        : [];
    const evidence = [
      ...envEvidence,
      ...toolEvidence,
      ...briefEvidence,
      ...costEvidence
    ];
    if (evidence.length === 0) {
      return { ok: true };
    }
    return {
      ok: false,
      mode: 'hard-fail',
      reason: `${evidence.length} subscription-only violation${evidence.length === 1 ? '' : 's'} detected — paid-API keys, per-token costs, or paid-SaaS phrasings.`,
      suggestedFix:
        'Run the dispatch via the operator Pro/Max subscription (Claude Code or Cowork). Remove ANTHROPIC_API_KEY / OPENAI_API_KEY / MAX_TOKENS from env. Drop any "$N per million" or "max-tokens" budget lines. If a paid SaaS is genuinely required, surface an OperatorEscalation (category=billing-model-change) before dispatching.',
      evidence
    };
  }
};
