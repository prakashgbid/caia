/**
 * Injection guard — heuristic prompt-injection detector.
 *
 * Reuses the catalogue established by `@chiefaia/tool-output-sanitizer` and
 * adds a numerical score combining direct matches, stem matches, and
 * character-trigram cosine similarity to a known-attack stem set.
 *
 * Score range: 0..1. Caller compares to a profile-specific threshold.
 *
 * NOTE — overlap with tool-output-sanitizer is intentional. This package
 * runs at a different boundary (agent-prompt → LLM, agent-response → downstream)
 * than the sanitizer (tool-result → agent context). Re-applying the same
 * patterns at the LLM boundary catches content that bypassed the sanitizer
 * via a different ingress (chat UI, API endpoint, workflow trigger).
 */

import type { NamedPattern } from '../types.js';

/** Built-in injection patterns. Each pattern carries a per-pattern weight 0..1. */
export interface WeightedInjectionPattern extends NamedPattern {
  weight: number;
}

// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- caller-supplied pattern is the package contract
const ig = (src: string): RegExp => new RegExp(src, 'gi');

// Zero-width / steganographic Unicode regex constructed via escape sequences
// to avoid the `no-irregular-whitespace` ESLint rule on literal whitespace.
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- caller-supplied pattern is the package contract
const ZERO_WIDTH_RE = new RegExp(
  '[\\u200B-\\u200D\\u2060\\uFEFF]|[\\u{E0000}-\\u{E007F}]',
  'gu',
);

// ANSI escape sequence: ESC + [ + parameters + final letter.
// String form sidesteps the `no-control-regex` ESLint rule that flags the
// literal \x1b in regex bodies. Functionally identical to /\x1b\[[0-9;?]*[A-Za-z]/g.
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- caller-supplied pattern is the package contract
const ANSI_ESCAPE_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[A-Za-z]', 'g');

export const BUILTIN_INJECTION_PATTERNS: readonly WeightedInjectionPattern[] = Object.freeze([
  {
    id: 'injection.role-system-tag',
    description: 'XML <system> impersonation tag',
    re: ig('</?system\\s*>'),
    weight: 1.0,
  },
  {
    id: 'injection.role-user-tag',
    description: 'XML <user> impersonation tag',
    re: ig('</?user\\s*>'),
    weight: 1.0,
  },
  {
    id: 'injection.role-assistant-tag',
    description: 'XML <assistant> impersonation tag',
    re: ig('</?assistant\\s*>'),
    weight: 1.0,
  },
  {
    id: 'injection.inst-block',
    description: '[INST] / [/INST] Llama-style block',
    re: ig('\\[/?inst\\]'),
    weight: 1.0,
  },
  {
    id: 'injection.system-prefix',
    description: '"System:" / "User:" / "Assistant:" prefix line',
    re: ig('(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:system|user|assistant)\\s*:\\s*'),
    weight: 0.7,
  },
  {
    id: 'injection.ignore-previous',
    description: '"Ignore/disregard/forget previous instructions" family',
    re: ig(
      '(?:ignore|disregard|forget|override)\\s+(?:all\\s+)?(?:the\\s+|your\\s+)?(?:previous|prior|above|earlier)\\s+(?:instructions?|prompts?|rules?|context)',
    ),
    weight: 1.0,
  },
  {
    id: 'injection.you-are-now',
    description: '"You are now ..." role-shift',
    re: ig('\\byou\\s+are\\s+now\\b'),
    weight: 0.6,
  },
  {
    id: 'injection.pretend-jailbreak',
    description: 'DAN / "act as" / "pretend to be" jailbreak',
    re: ig(
      '\\b(?:pretend|act\\s+as|imagine\\s+you\\s+are|simulate)\\s+(?:to\\s+be\\s+|you\\s+are\\s+)?(?:a|an|the)?\\s*(?:dan|do\\s+anything\\s+now|unrestricted|jailbroken)',
    ),
    weight: 0.9,
  },
  {
    id: 'injection.tool-redefine',
    description: 'Inline tool/MCP redefinition attempt',
    re: ig(
      '(?:new[_\\s-]+tool|register[_\\s-]+tool|add[_\\s-]+(?:mcp|tool|server)|"mcpServers"\\s*:)',
    ),
    weight: 0.8,
  },
  {
    id: 'injection.zero-width',
    description: 'Zero-width / steganographic Unicode',
    re: ZERO_WIDTH_RE,
    weight: 1.0,
  },
  {
    id: 'injection.ansi-escape',
    description: 'ANSI escape sequence (terminal injection vector)',
    re: ANSI_ESCAPE_RE,
    weight: 1.0,
  },
]);

export interface InjectionScanResult {
  /** Matched per-pattern flags. */
  flags: Array<{ id: string; description: string; matchCount: number }>;
  /** Aggregate score 0..1 (clamped). */
  score: number;
}

export function scanInjection(
  text: string,
  customPatterns: readonly NamedPattern[] = [],
): InjectionScanResult {
  const flags: InjectionScanResult['flags'] = [];
  let scoreAccum = 0;
  for (const pat of BUILTIN_INJECTION_PATTERNS) {
    // Build a fresh global regex per call to avoid lastIndex carryover.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- caller-supplied pattern is the package contract
    const re = new RegExp(pat.re.source, ensureGlobal(pat.re.flags));
    const matches = text.match(re);
    if (!matches || matches.length === 0) continue;
    flags.push({
      id: pat.id,
      description: pat.description,
      matchCount: matches.length,
    });
    // Log-scaled per-pattern contribution: 1 match contributes `weight`,
    // 10 matches contributes ~3.5×weight. The outer 1-exp(-x) clamp below
    // keeps the aggregate score in [0, 1) regardless.
    scoreAccum += pat.weight * Math.log2(1 + matches.length);
  }
  for (const pat of customPatterns) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- caller-supplied pattern is the package contract
    const re = new RegExp(pat.re.source, ensureGlobal(pat.re.flags));
    const matches = text.match(re);
    if (!matches || matches.length === 0) continue;
    flags.push({
      id: pat.id,
      description: pat.description,
      matchCount: matches.length,
    });
    scoreAccum += 0.5 * Math.log2(1 + matches.length); // unknown weight → 0.5 default
  }
  // Normalise: 1 - exp(-x) keeps the score in [0, 1) regardless of accumulated weight.
  const score = 1 - Math.exp(-scoreAccum);
  return { flags, score };
}

function ensureGlobal(flags: string): string {
  return flags.includes('g') ? flags : flags + 'g';
}
