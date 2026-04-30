/**
 * Prompt-injection pattern catalogue (per v2 §5.2.4).
 *
 * Each pattern is one of:
 *  - `strip`   — remove all matches from the payload, record a flag.
 *  - `reject`  — refuse the entire payload (return a sanitized stub).
 *  - `flag`    — leave intact but emit a flag for audit.
 *
 * Patterns are evaluated in order. Patterns are case-insensitive unless
 * explicitly marked otherwise.
 *
 * Reference: caia/docs/prompt-injection-defense.md, OWASP LLM Top-10
 * 2026-04 corpus, v2 §5.2.4.
 */

export type SanitizerAction = 'strip' | 'reject' | 'flag';

export interface SanitizerPattern {
  /** Stable id for audit logs + flag arrays. */
  id: string;
  description: string;
  /** Compiled regex (built with `i` + `g` for `strip`). */
  re: RegExp;
  action: SanitizerAction;
}

/** Helper: build a case-insensitive global regex. */
function ig(src: string): RegExp {
  // `src` is a literal pattern from this same file's PARANOID_PATTERNS
  // catalogue. No request-time user input flows here.
  return new RegExp(src, 'gi'); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
}

/**
 * Patterns enabled in the default `paranoid` strictness — used for any
 * untrusted source (web fetch, browser/computer-use OCR, third-party
 * MCP, user-uploaded files).
 */
export const PARANOID_PATTERNS: readonly SanitizerPattern[] = Object.freeze([
  // ── Role-impersonation markers (XML/JSON/chat-template style) ──
  {
    id: 'role-system-tag',
    description: 'XML <system> / </system> impersonation marker',
    re: ig('</?system\\s*>'),
    action: 'strip',
  },
  {
    id: 'role-user-tag',
    description: 'XML <user> / </user> impersonation marker',
    re: ig('</?user\\s*>'),
    action: 'strip',
  },
  {
    id: 'role-assistant-tag',
    description: 'XML <assistant> / </assistant> impersonation marker',
    re: ig('</?assistant\\s*>'),
    action: 'strip',
  },
  {
    id: 'inst-block',
    description: '[INST] … [/INST] Llama-style instruction block',
    re: ig('\\[/?inst\\]'),
    action: 'strip',
  },
  {
    id: 'system-prefix',
    description: '"### System:" / "System:" prefix lines',
    re: ig('(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:system|user|assistant)\\s*:\\s*'),
    action: 'flag',
  },
  // ── "Ignore previous" family ──
  {
    id: 'ignore-previous',
    description: '"Ignore previous instructions" + close cousins',
    re: ig(
      '(?:ignore|disregard|forget|override)\\s+(?:all\\s+)?(?:the\\s+|your\\s+)?(?:previous|prior|above|earlier)\\s+(?:instructions?|prompts?|rules?|context)',
    ),
    action: 'flag',
  },
  {
    id: 'you-are-now',
    description: '"You are now …" role-shift',
    re: ig('\\byou\\s+are\\s+now\\b'),
    action: 'flag',
  },
  {
    id: 'pretend-jailbreak',
    description: '"Pretend / Act as / DAN" jailbreak templates',
    re: ig(
      '\\b(?:pretend|act\\s+as|imagine\\s+you\\s+are|simulate)\\s+(?:to\\s+be\\s+|you(?:\\\\\'re|\\s+are)\\s+)?(?:a|an|the)?\\s*(?:dan|do\\s+anything\\s+now|unrestricted|jailbroken)',
    ),
    action: 'flag',
  },
  // ── Tool-definition injection (CurXecute / NEW_TOOL family) ──
  {
    id: 'tool-redefine',
    description: 'Inline tool/MCP redefinition attempt',
    re: ig(
      '(?:new[_\\s-]+tool|register[_\\s-]+tool|add[_\\s-]+(?:mcp|tool|server)|"mcpServers"\\s*:)',
    ),
    action: 'flag',
  },
  // ── ANSI / terminal-injection ──
  {
    id: 'ansi-escape',
    description: 'ANSI escape sequence (terminal injection vector)',
    // eslint-disable-next-line no-control-regex
    re: /\[[0-9;?]*[A-Za-z]/g,
    action: 'strip',
  },
  // ── Zero-width / steganographic Unicode ──
  {
    id: 'zero-width',
    description:
      'Zero-width / hidden Unicode (U+200B-U+200D, U+2060, U+FEFF, U+E0000-U+E007F tag block)',
    re: /[\u200B-\u200D\u2060\uFEFF]|[\u{E0000}-\u{E007F}]/gu,
    action: 'strip',
  },
  // ── Long base64 blobs masquerading as instructions ──
  {
    id: 'long-base64',
    description: 'Suspicious base64 blob > 256 chars (possible smuggled prompt)',
    re: /[A-Za-z0-9+/]{256,}={0,2}/g,
    action: 'flag',
  },
]);

/**
 * Lenient strictness — used for trusted MCP servers we wrote (mac-mcp,
 * stolution-remote). Strips control tokens but flags rather than rejects
 * suspect prose, since these tools regularly return code/configs that
 * legitimately contain words like "system" or "user".
 */
export const LENIENT_PATTERNS: readonly SanitizerPattern[] = Object.freeze(
  PARANOID_PATTERNS.filter((p) => p.action !== 'reject'),
);

export function patternsForStrictness(
  strictness: 'paranoid' | 'lenient',
): readonly SanitizerPattern[] {
  return strictness === 'paranoid' ? PARANOID_PATTERNS : LENIENT_PATTERNS;
}
