/**
 * JSON extraction — some models ignore response_format:json and wrap the
 * JSON in prose or fenced code blocks. This finds and parses the first
 * valid JSON value in the string.
 */

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

export interface JsonExtractResult {
  ok: true;
  value: unknown;
}
export interface JsonExtractFailure {
  ok: false;
  reason: string;
}

export function extractJson(text: string): JsonExtractResult | JsonExtractFailure {
  if (!text || text.trim().length === 0) return { ok: false, reason: 'empty text' };

  // 1. Whole text is JSON?
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      /* fall through */
    }
  }

  // 2. Fenced code block?
  const fenceMatch = FENCE_RE.exec(text);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return { ok: true, value: JSON.parse(fenceMatch[1].trim()) };
    } catch {
      /* fall through */
    }
  }

  // 3. First brace-matched substring
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const start = firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket) ? firstBrace : firstBracket;
  if (start < 0) return { ok: false, reason: 'no { or [ found' };

  const openChar = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) {
        try {
          return { ok: true, value: JSON.parse(text.slice(start, i + 1)) };
        } catch {
          return { ok: false, reason: 'brace-matched substring failed JSON.parse' };
        }
      }
    }
  }
  return { ok: false, reason: 'unbalanced braces' };
}
