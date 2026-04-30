/**
 * Tool-result sanitizer.
 *
 * Every MCP / HTTP / file-read response runs through `sanitizeToolResult`
 * before reaching the agent's context window. Strips known prompt-
 * injection markers, records what was stripped (for audit), and on
 * `paranoid` strictness rejects the entire payload when a high-risk
 * pattern matches.
 *
 * Reference: caia/docs/prompt-injection-defense.md, v2 §5.2.4.
 */

import {
  patternsForStrictness,
  type SanitizerPattern,
} from './patterns.js';

export type Strictness = 'paranoid' | 'lenient';

export interface SanitizeOptions {
  /** Default 'paranoid'. Use 'lenient' only for vendored first-party MCPs. */
  strictness?: Strictness;
  /**
   * Maximum payload length (chars) before truncation. Default 256 KiB.
   * Long payloads are a known smuggling channel.
   */
  maxLength?: number;
  /** Optional override list. Replaces the default patterns when supplied. */
  patterns?: readonly SanitizerPattern[];
}

export interface SanitizedResult {
  /** Payload safe to feed back into agent context. */
  payload: string;
  /**
   * Summary of every transformation applied. One entry per pattern that
   * matched; the dashboard renders these on the "Tool output rejected"
   * page.
   */
  flags: Array<{
    id: string;
    description: string;
    action: 'stripped' | 'flagged' | 'rejected' | 'truncated';
    matchCount: number;
  }>;
  /** True if the entire payload was rejected and replaced with a stub. */
  rejected: boolean;
  /** True if the payload was truncated to maxLength. */
  truncated: boolean;
}

const REJECTED_STUB =
  '[tool-output-sanitizer: payload rejected — matched a high-risk prompt-injection pattern. See caia/docs/prompt-injection-defense.md.]';

/**
 * Sanitize a raw tool result before injecting it back into the agent's
 * context. Accepts arbitrary unknown input; non-string values are
 * JSON.stringify'd then sanitized as text.
 */
export function sanitizeToolResult(
  raw: unknown,
  opts: SanitizeOptions = {},
): SanitizedResult {
  const strictness = opts.strictness ?? 'paranoid';
  const maxLength = opts.maxLength ?? 256 * 1024;
  const patterns = opts.patterns ?? patternsForStrictness(strictness);

  let text: string;
  if (typeof raw === 'string') {
    text = raw;
  } else if (raw === null || raw === undefined) {
    text = '';
  } else {
    try {
      text = JSON.stringify(raw);
    } catch {
      text = String(raw);
    }
  }

  const flags: SanitizedResult['flags'] = [];
  let truncated = false;
  if (text.length > maxLength) {
    flags.push({
      id: 'over-max-length',
      description: `payload exceeded maxLength=${maxLength}`,
      action: 'truncated',
      matchCount: 1,
    });
    text = text.slice(0, maxLength);
    truncated = true;
  }

  let rejected = false;
  for (const pat of patterns) {
    const matches = text.match(pat.re);
    if (!matches || matches.length === 0) continue;
    if (pat.action === 'reject') {
      flags.push({
        id: pat.id,
        description: pat.description,
        action: 'rejected',
        matchCount: matches.length,
      });
      rejected = true;
      // Don't return early — finish accumulating flags so the audit
      // record names every offending pattern.
      continue;
    }
    if (pat.action === 'strip') {
      // Build a fresh global regex so per-call lastIndex doesn't bite us.
      // pat.re is the catalogue regex; we rebuild a fresh global instance
      // here so .replace can iterate without lastIndex carryover. Source
      // is the catalogue, not user input.
      const stripRe = new RegExp(pat.re.source, ensureGlobal(pat.re.flags)); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      text = text.replace(stripRe, '');
      flags.push({
        id: pat.id,
        description: pat.description,
        action: 'stripped',
        matchCount: matches.length,
      });
      continue;
    }
    // 'flag' — leave intact, record observation.
    flags.push({
      id: pat.id,
      description: pat.description,
      action: 'flagged',
      matchCount: matches.length,
    });
  }

  if (rejected) {
    return {
      payload: REJECTED_STUB,
      flags,
      rejected: true,
      truncated,
    };
  }

  return {
    payload: text,
    flags,
    rejected: false,
    truncated,
  };
}

function ensureGlobal(flags: string): string {
  return flags.includes('g') ? flags : flags + 'g';
}

/**
 * Convenience: sanitize an MCP `tools/call` response's `content` blocks
 * (the spec wraps text in `{type:'text', text:string}` objects).
 */
export function sanitizeMcpToolResult(
  result: unknown,
  opts: SanitizeOptions = {},
): { result: unknown; flags: SanitizedResult['flags']; rejected: boolean } {
  if (
    result === null ||
    typeof result !== 'object' ||
    !('content' in result) ||
    !Array.isArray((result as { content: unknown }).content)
  ) {
    const r = sanitizeToolResult(result, opts);
    return { result: r.payload, flags: r.flags, rejected: r.rejected };
  }
  const content = (result as { content: Array<Record<string, unknown>> }).content;
  let allFlags: SanitizedResult['flags'] = [];
  let anyRejected = false;
  const cleaned = content.map((block) => {
    if (typeof block.text !== 'string') return block;
    const r = sanitizeToolResult(block.text, opts);
    allFlags = allFlags.concat(r.flags);
    if (r.rejected) anyRejected = true;
    return { ...block, text: r.payload };
  });
  return {
    result: { ...(result as Record<string, unknown>), content: cleaned },
    flags: allFlags,
    rejected: anyRejected,
  };
}
