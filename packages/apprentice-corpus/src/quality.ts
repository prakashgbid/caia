/**
 * Quality scorer.
 *
 * Each InstructionPair gets a score in [0, 1]. Components:
 *
 *   length-band:   0.30 if response length is comfortably inside the
 *                  band [minLen, maxLen]; tapers off at the edges.
 *   structure:     0.20 if the response has bullets / headers / multi-
 *                  paragraph structure.
 *   operator-voice:0.20 if source is `directive` or `feedback` from
 *                  memory (high signal for the project's idiom).
 *   filler-penalty:up to 0.20 deducted for thinking-aloud / voice-
 *                  transcription filler ("um", "you know", "...kind of").
 *   code-bonus:    0.10 if response is mostly code (≥70% inside ```).
 *
 * Sum is clamped to [0, 1].
 */

import type { InstructionPair } from './types.js';

export interface QualityOptions {
  minSampleLengthChars: number;
  maxSampleLengthChars: number;
}

const FILLER_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\bum+\b/gi,
  /\buh+\b/gi,
  /\byou know\b/gi,
  /\bkind of\b/gi,
  /\bsort of\b/gi,
  /\.\.\.\s*so\b/gi
]);

export function scoreOne(pair: InstructionPair, opts: QualityOptions): number {
  const response = pair.messages.find((m) => m.role === 'assistant')?.content ?? '';
  const len = response.length;

  // Length floor — too-short samples are unusable; no other component
  // can rescue them. Returning 0 here makes the score-zero contract
  // explicit and matches the normaliser's drop behaviour.
  if (len < opts.minSampleLengthChars) return 0;

  // Length band — full credit at midpoint, taper off at edges
  let lengthScore: number;
  const lo = opts.minSampleLengthChars;
  const hi = opts.maxSampleLengthChars;
  const sweet = lo + (hi - lo) * 0.4; // sweet spot is in the lower-middle of the band
  if (len < lo) {
    lengthScore = 0;
  } else if (len <= sweet) {
    lengthScore = 0.3 * ((len - lo) / Math.max(1, sweet - lo));
  } else if (len <= hi) {
    // taper from 0.3 down to 0.15 as we approach hi
    lengthScore = 0.3 - 0.15 * ((len - sweet) / Math.max(1, hi - sweet));
  } else {
    lengthScore = 0.1; // overflow penalised but not zero
  }

  // Structure — bullets / headers / multi-paragraph
  const hasBullets = /^[-*]\s/m.test(response);
  const hasHeaders = /^#{1,6}\s/m.test(response);
  const paragraphs = response.split(/\n\n+/).filter((s) => s.trim() !== '').length;
  const structureScore = hasBullets || hasHeaders || paragraphs > 1 ? 0.2 : 0;

  // Operator voice — memory directives + feedback
  const operatorVoiceScore =
    pair.meta.source === 'memory'
    && (pair.meta.kind === 'directive' || pair.meta.kind === 'feedback')
      ? 0.2
      : 0;

  // Filler penalty — count occurrences across all patterns
  let fillerHits = 0;
  for (const re of FILLER_PATTERNS) {
    const matches = response.match(re);
    if (matches !== null) fillerHits += matches.length;
  }
  const fillerPenalty = Math.min(0.2, fillerHits * 0.04);

  // Code bonus — fraction of chars inside fenced code blocks
  const codeFraction = computeCodeFraction(response);
  const codeBonus = codeFraction >= 0.7 ? 0.1 : 0;

  const raw = lengthScore + structureScore + operatorVoiceScore + codeBonus - fillerPenalty;
  return Math.max(0, Math.min(1, raw));
}

export function scoreAll(
  pairs: ReadonlyArray<InstructionPair>,
  opts: QualityOptions
): InstructionPair[] {
  return pairs.map((p) => ({
    ...p,
    meta: { ...p.meta, qualityScore: scoreOne(p, opts) }
  }));
}

function computeCodeFraction(text: string): number {
  if (text.length === 0) return 0;
  let codeChars = 0;
  let inCode = false;
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) codeChars += line.length + 1; // +1 for newline
  }
  return codeChars / text.length;
}
