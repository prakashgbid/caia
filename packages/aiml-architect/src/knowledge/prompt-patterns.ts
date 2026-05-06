/**
 * The 12 canonical prompt-engineering patterns + anti-patterns,
 * with the trigger rules that decide when each applies.
 *
 * This module is pure data + pure functions. The reviewer in
 * `review-prompt-pattern.ts` walks these rules over a template
 * and emits findings.
 *
 * Rules are intentionally simple (regex + heuristics) — the architect's
 * value is in the taxonomy, not in deep semantic analysis. For deep
 * semantic checks, the reviewer recommends DSPy compilation instead.
 */

import type { PromptFinding, PromptPatternKind } from '../types.js';

export interface PromptPatternRule {
  readonly pattern: PromptPatternKind;
  readonly weight: number;
  /** Returns finding(s) when the rule trips. Returns [] when it passes. */
  readonly check: (input: PromptCheckInput) => PromptFinding[];
}

export interface PromptCheckInput {
  readonly template: string;
  readonly intendedTaskCategory: string;
  readonly expectedOutputShape: 'plain' | 'json' | 'markdown' | 'code';
}

/**
 * Patterns whose presence improves the score, and anti-patterns whose
 * presence drags it down.
 *
 * Weights sum to ~1 so the score is normalised in [0, 1].
 */
export const PROMPT_PATTERN_RULES: ReadonlyArray<PromptPatternRule> = [
  {
    pattern: 'role',
    weight: 0.10,
    check: ({ template }) => {
      const hasRole = /you are\b|act as\b|^role:/im.test(template);
      if (hasRole) return [];
      return [
        {
          pattern: 'role',
          severity: 'warn',
          detail:
            'Template does not specify the model\'s role. Industry baseline: ' +
            'every prompt should set a role (helps disambiguate context for the model).',
          recommendation:
            'Add a role line at the top, e.g. "You are a TypeScript code reviewer."'
        }
      ];
    }
  },
  {
    pattern: 'system-block',
    weight: 0.10,
    check: ({ template }) => {
      const hasSystemBlock =
        /^system:|<\|system\|>|^### system\b/im.test(template);
      if (hasSystemBlock) return [];
      return [
        {
          pattern: 'system-block',
          severity: 'info',
          detail:
            'No explicit system block detected. For multi-turn agents, an explicit ' +
            'system block separates instructions from user-supplied context.'
        ,
          recommendation:
            'For multi-turn agents, prefix instructions with an explicit ' +
            '"system:" or "### System" block.'
        }
      ];
    }
  },
  {
    pattern: 'output-shape',
    weight: 0.15,
    check: ({ template, expectedOutputShape }) => {
      if (expectedOutputShape === 'plain') return [];
      const lower = template.toLowerCase();
      const mentionsShape =
        (expectedOutputShape === 'json' && /\bjson\b/.test(lower)) ||
        (expectedOutputShape === 'markdown' && /\bmarkdown\b/.test(lower)) ||
        (expectedOutputShape === 'code' &&
          /\b(?:code|typescript|javascript|python)\b/.test(lower));
      if (mentionsShape) return [];
      return [
        {
          pattern: 'output-shape',
          severity: 'error',
          detail:
            `Template expects ${expectedOutputShape} output but does not state it. ` +
            'Models default to free-form prose without explicit shape constraint.',
          recommendation:
            `State the output shape explicitly: "Output ${expectedOutputShape} ` +
            `with the following fields: …"`
        }
      ];
    }
  },
  {
    pattern: 'json-shape',
    weight: 0.10,
    check: ({ template, expectedOutputShape }) => {
      if (expectedOutputShape !== 'json') return [];
      const hasJsonExample = /```json|"\w+"\s*:\s*"/.test(template);
      if (hasJsonExample) return [];
      return [
        {
          pattern: 'json-shape',
          severity: 'error',
          detail:
            'JSON output expected but template provides no schema example. ' +
            'Models hallucinate keys without a concrete shape.',
          recommendation:
            'Include a code-fenced JSON example: ```json\\n{ "field": "value" }\\n```.'
        }
      ];
    }
  },
  {
    pattern: 'few-shot',
    weight: 0.10,
    check: ({ template, intendedTaskCategory }) => {
      const isClassification = /classif|categor|label|tag|triage/i.test(
        intendedTaskCategory
      );
      if (!isClassification) return [];
      const hasFewShot =
        /(?:example|input|case)\s*\d+\s*:|^example:|^q:.*\na:/im.test(template);
      if (hasFewShot) return [];
      return [
        {
          pattern: 'few-shot',
          severity: 'warn',
          detail:
            'Classification task detected but template has no few-shot examples. ' +
            'Few-shot dramatically improves classification accuracy.',
          recommendation:
            'Add 3-5 (input, label) examples in the template body.'
        }
      ];
    }
  },
  {
    pattern: 'cot',
    weight: 0.10,
    check: ({ template, intendedTaskCategory }) => {
      const needsCot =
        /reason|formal|math|stem|hierarchy|decomp|architect/i.test(
          intendedTaskCategory
        );
      if (!needsCot) return [];
      const hasCot =
        /step[\s-]?by[\s-]?step|think (?:through|carefully)|reason about/i.test(
          template
        );
      if (hasCot) return [];
      return [
        {
          pattern: 'cot',
          severity: 'warn',
          detail:
            'Reasoning-heavy task detected but template does not invoke ' +
            'chain-of-thought ("step by step" / "think through").',
          recommendation:
            'Add "Think through this step by step." before requesting the ' +
            'answer. For high-stakes decisions, also ask for the reasoning ' +
            'BEFORE the answer.'
        }
      ];
    }
  },
  {
    pattern: 'self-consistency',
    weight: 0.05,
    check: ({ template, intendedTaskCategory }) => {
      const needsSelfConsistency =
        /judge|adjudicat|score|verify/i.test(intendedTaskCategory);
      if (!needsSelfConsistency) return [];
      const mentionsSampling = /sample (?:n|\d+) times|self[\s-]?consist/i.test(
        template
      );
      if (mentionsSampling) return [];
      return [
        {
          pattern: 'self-consistency',
          severity: 'info',
          detail:
            'Judging task — consider self-consistency (multiple samples, majority vote) ' +
            'for higher reliability on borderline cases.',
          recommendation:
            'When reliability matters, sample N=5 outputs at non-zero temperature ' +
            'and pick the majority answer.'
        }
      ];
    }
  },
  {
    pattern: 'rag',
    weight: 0.05,
    check: ({ template }) => {
      const hasContextSection = /context:|retrieved:|sources:|---\s*$/m.test(
        template
      );
      if (hasContextSection) return [];
      return [];
    }
  },
  {
    pattern: 'react',
    weight: 0.05,
    check: () => []
  },
  {
    pattern: 'tree-of-thought',
    weight: 0.05,
    check: () => []
  },
  {
    pattern: 'token-waste',
    weight: 0.10,
    check: ({ template }) => {
      const trimmed = template.trim();
      if (trimmed.length === 0) return [];
      const politenessCount = (template.match(/\bplease\b/gi) ?? []).length;
      if (politenessCount >= 4) {
        return [
          {
            pattern: 'token-waste',
            severity: 'warn',
            detail:
              `Template contains "please" ${politenessCount} times — politeness ` +
              'wastes tokens without improving model behaviour.',
            recommendation:
              'Strip filler politeness. Models do not respond better to "please" ' +
              'past the first instance.'
          }
        ];
      }
      return [];
    }
  },
  {
    pattern: 'ambiguity',
    weight: 0.05,
    check: ({ template }) => {
      const negationDensity =
        ((template.match(/\b(?:not|no|never|don't|do not)\b/gi) ?? []).length /
          Math.max(1, template.split(/\s+/).length)) * 100;
      if (negationDensity > 5) {
        return [
          {
            pattern: 'ambiguity',
            severity: 'warn',
            detail:
              `High negation density (${negationDensity.toFixed(1)}%). ` +
              'Models perform worse on prompts with stacked negations.',
            recommendation:
              'Rewrite negations as positive instructions: "must X" instead of ' +
              '"do not Y".'
          }
        ];
      }
      return [];
    }
  }
];

/**
 * Combine findings into a normalised score in [0, 1].
 */
export function scoreFromFindings(
  findings: ReadonlyArray<PromptFinding>
): number {
  const totalWeight = PROMPT_PATTERN_RULES.reduce(
    (acc, r) => acc + r.weight,
    0
  );
  let lossWeight = 0;
  for (const f of findings) {
    const rule = PROMPT_PATTERN_RULES.find((r) => r.pattern === f.pattern);
    if (!rule) continue;
    const penalty =
      f.severity === 'info' ? 0.1 : f.severity === 'warn' ? 0.5 : 1.0;
    lossWeight += rule.weight * penalty;
  }
  const lossFraction = totalWeight === 0 ? 0 : lossWeight / totalWeight;
  return Math.max(0, Math.min(1, 1 - lossFraction));
}
