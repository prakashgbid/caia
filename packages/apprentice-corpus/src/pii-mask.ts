/**
 * PII / credential masker.
 *
 * Three regex passes, conservative — false-positives accepted, false
 * negatives unacceptable. The set of redacted span types is recorded
 * per-sample in `meta.redactedSpans` for audit.
 *
 * Operator's name + email NOT auto-redacted — they appear deliberately
 * in directives + memory and are intentional training signal. Add them
 * via `extraRedactPatterns` if a downstream consumer wants them gone.
 */

export interface RedactPattern {
  tag: string;
  pattern: RegExp;
  replacement: string;
}

/** Built-in default patterns. Order matters — secret-shapes come first to avoid masking inside emails. */
export const DEFAULT_REDACT_PATTERNS: ReadonlyArray<RedactPattern> = Object.freeze([
  // Anthropic / OpenAI API key shape
  { tag: 'secret', pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: '[redacted-secret]' },
  // GitHub PAT
  { tag: 'secret', pattern: /\bghp_[A-Za-z0-9]{36}\b/g, replacement: '[redacted-secret]' },
  // GitHub fine-grained PAT
  { tag: 'secret', pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, replacement: '[redacted-secret]' },
  // GitLab PAT
  { tag: 'secret', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, replacement: '[redacted-secret]' },
  // AWS access key
  { tag: 'secret', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[redacted-secret]' },
  // Generic secret-keyword + value (token=…, password=…, api_key=…)
  {
    tag: 'secret',
    pattern: /\b(?:secret|password|passwd|api[_-]?key|token|bearer)\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{16,})["']?/gi,
    replacement: '[redacted-secret-kv]'
  },
  // Email
  { tag: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[redacted-email]' },
  // Mac home path with username
  { tag: 'path', pattern: /\/Users\/[A-Za-z0-9_-]+\//g, replacement: '~/' },
  // Linux home path with username
  { tag: 'path', pattern: /\/home\/[A-Za-z0-9_-]+\//g, replacement: '~/' }
]);

export interface MaskResult {
  masked: string;
  redactedSpans: string[];
}

/**
 * Apply all patterns to `text` and return the redacted version plus
 * the unique set of tag names that fired. The returned `redactedSpans`
 * is sorted alphabetically for stable test snapshots.
 */
export function applyPiiMask(
  text: string,
  patterns: ReadonlyArray<RedactPattern> = DEFAULT_REDACT_PATTERNS
): MaskResult {
  const redacted = new Set<string>();
  let out = text;
  for (const p of patterns) {
    if (p.pattern.test(out)) {
      // Reset lastIndex from the test() call before replace
      p.pattern.lastIndex = 0;
      out = out.replace(p.pattern, p.replacement);
      redacted.add(p.tag);
    }
    // Reset for next call
    p.pattern.lastIndex = 0;
  }
  return { masked: out, redactedSpans: Array.from(redacted).sort() };
}
