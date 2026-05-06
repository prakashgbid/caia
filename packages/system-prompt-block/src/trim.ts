/**
 * Token-budget enforcement — when the assembled primer would exceed the
 * configured budget, progressively summarise the standing-instructions
 * bullets (the largest variable section) until it fits.
 *
 * Strategy (deterministic):
 *
 *   1. Start with full bullets.
 *   2. If over budget, truncate each standing-instruction bullet to the
 *      first sentence (`. ` boundary).
 *   3. If still over budget, drop the architecture-TOC down to the first
 *      8 entries (load-bearing only).
 *   4. If still over budget, throw — at this point the source files are
 *      genuinely too large for a 1K-token primer and need editing.
 *
 * Each stage is deterministic given the same input — running it twice
 * yields byte-identical output.
 */

import { estimateTokens } from './token-estimate.js';
import { renderPrimer } from './render.js';

export interface TrimInput {
  standingInstructions: string[];
  architectureToc: string[];
  dodStages: string[];
  tokenBudget: number;
}

export interface TrimOutput {
  text: string;
  estimatedTokens: number;
  trimmed: boolean;
}

/**
 * Trim the primer parts until they fit `tokenBudget`. Returns the
 * rendered text + final token count + whether trimming was needed.
 *
 * Throws if the smallest-possible primer still exceeds the budget.
 */
export function trimToBudget(input: TrimInput): TrimOutput {
  const { tokenBudget } = input;
  const stages: Array<{
    name: string;
    transform: (parts: TrimInput) => TrimInput;
  }> = [
    { name: 'full', transform: (p) => p },
    {
      name: 'first-sentence-only',
      transform: (p) => ({
        ...p,
        standingInstructions: p.standingInstructions.map(firstSentence)
      })
    },
    {
      name: 'truncate-arch-toc',
      transform: (p) => ({
        ...p,
        standingInstructions: p.standingInstructions.map(firstSentence),
        architectureToc: p.architectureToc.slice(0, 8)
      })
    },
    {
      name: 'titles-only',
      transform: (p) => ({
        ...p,
        standingInstructions: p.standingInstructions.map(linkTitle),
        architectureToc: p.architectureToc.slice(0, 8)
      })
    }
  ];

  let trimmed = false;
  for (const stage of stages) {
    const current = stage.transform(input);
    const text = renderPrimer({
      standingInstructions: current.standingInstructions,
      architectureToc: current.architectureToc,
      dodStages: current.dodStages
    });
    const tokens = estimateTokens(text);
    if (tokens <= tokenBudget) {
      return { text, estimatedTokens: tokens, trimmed };
    }
    trimmed = true;
  }

  // Even after the smallest-stage trim, we're over budget. Surface
  // loudly — the source corpus has grown past what a 1K primer can
  // hold; the operator must edit MEMORY.md or relax the budget.
  const finalText = renderPrimer({
    standingInstructions: input.standingInstructions.map(linkTitle),
    architectureToc: input.architectureToc.slice(0, 8),
    dodStages: input.dodStages
  });
  const finalTokens = estimateTokens(finalText);
  throw new Error(
    `trimToBudget: even after maximum trimming the primer estimates at ` +
      `${finalTokens} tokens, over budget ${tokenBudget}. Edit MEMORY.md ` +
      `(fewer standing instructions) or raise tokenBudget.`
  );
}

/**
 * Take the first sentence of a bullet. Sentence boundary is `. `
 * (period + space) — robust against most prose, leaves the bullet
 * unchanged if no boundary is found.
 */
function firstSentence(s: string): string {
  const idx = s.indexOf('. ');
  if (idx === -1) return s;
  return s.slice(0, idx + 1);
}

/**
 * Most aggressive compaction: extract just the `[title](link)` portion
 * of a markdown bullet, dropping everything after. Preserves the 🚨
 * urgency prefix if present so the priority signal survives.
 *
 *   "🚨 [Foo bar](file.md) — descriptive text..."  →  "🚨 Foo bar"
 *   "[Foo](file.md) — descriptive text"            →  "Foo"
 *   "Plain bullet without link"                    →  "Plain bullet without link"
 */
function linkTitle(s: string): string {
  const m = /^(\s*🚨\s*)?\[([^\]]+)\]\([^)]+\)/.exec(s);
  if (m === null) return firstSentence(s);
  const prefix = m[1] !== undefined ? m[1].trim() + ' ' : '';
  return (prefix + (m[2] ?? '')).trim();
}
