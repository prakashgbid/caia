/**
 * Banned-phrase scanner — AUTON-001/002/006/007/008 enforcement.
 *
 * Scans outbound orchestrator messages for patterns that indicate the agent is
 * seeking permission, offering choices, or deferring a decision to the human.
 * All matching is case-insensitive.
 *
 * @no-events — pure validation utility; no domain events emitted.
 */

import type { BannedPhraseMatch, BannedPhraseResult } from './types.js';
import { BannedPhraseError } from './errors.js';

/** AUTON rule patterns, in order of priority. Each pattern has a human label. */
const BANNED_PHRASE_DEFINITIONS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'should I',               pattern: /should\s+i\b/i },
  { label: 'want me to',             pattern: /want\s+me\s+to\b/i },
  { label: "let me know if you'd like", pattern: /let\s+me\s+know\s+if\s+you'?d\s+like/i },
  { label: 'let me know if you want', pattern: /let\s+me\s+know\s+if\s+you\s+want/i },
  { label: 'please approve',         pattern: /please\s+approve\b/i },
  { label: 'do you want me to',      pattern: /do\s+you\s+want\s+me\s+to\b/i },
  { label: 'shall I',                pattern: /shall\s+i\b/i },
  { label: 'ready when you are',     pattern: /ready\s+when\s+you\s+are\b/i },
  // "confirm" used as a trailing question: "can you confirm?", "please confirm?"
  { label: 'confirm (as question)',  pattern: /\bconfirm\s*\?/i },
  // Binary choice offer: "A or B?"
  { label: 'A or B? (binary choice)', pattern: /\w.+\s+or\s+\w.+\?/i },
  { label: 'which would you prefer', pattern: /which\s+would\s+you\s+prefer\b/i },
  { label: 'your call',              pattern: /\byour\s+call\b/i },
];

/**
 * Compiled patterns exported for external inspection and testing.
 * Consumers must not mutate this array.
 */
export const BANNED_PHRASE_PATTERNS: RegExp[] = BANNED_PHRASE_DEFINITIONS.map(d => d.pattern);

const CONTEXT_WINDOW = 50;
const REWRITE_SUGGESTION =
  "Instead of asking, decide and state: 'Decided: X. Rationale: Y. In flight: Z.'";

/**
 * Extracts surrounding context from `message` centred on `position`.
 * Returns at most `CONTEXT_WINDOW` characters on each side.
 */
function extractContext(message: string, position: number, matchLength: number): string {
  const start = Math.max(0, position - CONTEXT_WINDOW);
  const end = Math.min(message.length, position + matchLength + CONTEXT_WINDOW);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < message.length ? '…' : '';
  return `${prefix}${message.slice(start, end)}${suffix}`;
}

/**
 * Scans `message` for all banned phrases defined by AUTON-001/002/006/007/008.
 *
 * @no-events — read-only scan; no side effects.
 * @param message - The outbound message text to scan.
 * @returns A `BannedPhraseResult` with all matches and a clean flag.
 */
export function scanForBannedPhrases(message: string): BannedPhraseResult {
  const violations: BannedPhraseMatch[] = [];

  for (const { label, pattern } of BANNED_PHRASE_DEFINITIONS) {
    // Reset lastIndex for global patterns (we compile without /g, so this is a no-op,
    // but kept for safety if patterns are changed to global in future).
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.includes('i') ? 'i' : ''}g`);
    let match: RegExpExecArray | null;

    while ((match = globalPattern.exec(message)) !== null) {
      violations.push({
        phrase: label,
        position: match.index,
        context: extractContext(message, match.index, match[0].length),
      });
      // Prevent infinite loop on zero-length matches
      if (match[0].length === 0) { globalPattern.lastIndex++; }
    }
  }

  return {
    violations,
    clean: violations.length === 0,
    rewriteSuggestion: violations.length > 0 ? REWRITE_SUGGESTION : undefined,
  };
}

/**
 * Asserts that `message` contains no banned phrases.
 * Throws `BannedPhraseError` on the first scan that finds violations.
 *
 * @no-events — throws synchronously; no side effects.
 * @throws {BannedPhraseError} when violations are detected.
 */
export function assertNoBannedPhrases(message: string): void {
  const result = scanForBannedPhrases(message);
  if (!result.clean) {
    throw new BannedPhraseError(result.violations);
  }
}
