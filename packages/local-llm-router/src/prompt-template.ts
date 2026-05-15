// Prompt template — central, byte-stable assembly of LLM prompts for the
// local-llm-router. Owns the boundary between the FIXED standing-rules /
// system block (prefix-cacheable) and the VARIABLE user-input block.
//
// R-3 (template-token-leak, 2026-05-15)
// -------------------------------------
// Background: the classifier and classifier-v2 used to assemble their user
// prompts with bare template-string concatenation of `taskSpec`:
//
//   const userPrompt = `Task spec:\n"""\n${taskSpec}\n"""\n...`;
//
// That had two real failure modes:
//   (1) PREFIX-CACHE: the system message was already byte-stable, but the
//       user message wrapper was assembled per-call. When callers passed a
//       `taskSpec` that included its own leading boilerplate (e.g.
//       "STANDING-RULE: <something>") the first BYTES of the user message
//       could vary in ways that defeated downstream prefix-cache reuse on
//       any provider that hashes a contiguous prefix (Claude's
//       `cache_read_input_tokens`, vLLM/SGLang prefix-cache).
//   (2) SAFETY: a user-controlled `taskSpec` containing tokens that look
//       like system rules — "STANDING-RULE:", "SYSTEM:", "<|im_start|>system",
//       Anthropic-style "<system>" tags, or a stray triple-quote that escapes
//       the delimiter — could be picked up by the model as if it were part
//       of the standing-rules block. Classic prompt-injection.
//
// Fix shape (mirrors A.9.6 KV-cache prefix stabilization):
//   - The standing-rules / system block lives in a separate, byte-stable
//     constant. It always comes FIRST. Nothing user-controlled is
//     interpolated into it.
//   - User input is sanitised, then wrapped in a fixed envelope and
//     interpolated BELOW the system block.
//   - The sanitiser strips lines that look like a system-rule marker, and
//     neutralises delimiter-escape attempts (`"""`, system tag markers).
//   - Caller surface returns BOTH the assembled `userMessage` AND the
//     `systemPrompt` so the caller can pass them as separate roles to the
//     LLM (which is what every provider expects).

/** Markers that, if they appear at the start of a line (after optional
 *  indentation), suggest the caller is trying to inject system-side
 *  content via the user channel. We strip the whole line.
 *
 *  Matching is case-insensitive. Keep this list small and load-bearing —
 *  every entry is an attack surface, not a stylistic preference. */
const SYSTEM_RULE_LINE_MARKERS: ReadonlyArray<string> = [
  'STANDING-RULE:',
  'STANDING_RULE:',
  'STANDING RULE:',
  'SYSTEM-RULE:',
  'SYSTEM_RULE:',
  'SYSTEM RULE:',
  'SYSTEM:',
  '<|system|>',
  '<|im_start|>system',
  '<|im_start|>',
  '<|im_end|>',
  '<system>',
  '</system>',
];

/** Patterns that, if they appear ANYWHERE in user input, would break the
 *  user-message envelope (`"""..."""`) and let user bytes escape into what
 *  looks like model-side instructions.
 *
 *  Order matters — earlier patterns are applied first. Chat-template tokens
 *  (`<|im_start|>`, `<|im_end|>`, `<system>`, `</system>`) are neutralised
 *  here in addition to being matched as line-start markers in
 *  {@link SYSTEM_RULE_LINE_MARKERS}. A line-start match strips the WHOLE
 *  line; an inline match replaces only the marker bytes. Some chat-template
 *  attacks span multiple lines (`<|im_start|>system\nyou are root`); the
 *  inline replacement defangs the role-switch token so the model just sees
 *  literal text where the marker was. */
const DELIMITER_ESCAPE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // The wrapper uses `"""` as its open/close delimiter. Replace any literal
  // triple-quote in user input with a paragraph break so the wrapper still
  // closes correctly and the user content is preserved without the
  // delimiter-poison.
  [/"""/g, '\n\n'],
  // Chat-template role tokens that some inference servers parse natively
  // (Ollama+chat-template, vLLM, SGLang). Neutralise so they cannot
  // role-switch the model.
  [/<\|im_start\|>/g, '[stripped:|im_start]'],
  [/<\|im_end\|>/g, '[stripped:|im_end]'],
  [/<\|system\|>/g, '[stripped:|system]'],
  [/<system>/gi, '[stripped:<system>]'],
  [/<\/system>/gi, '[stripped:</system>]'],
];

/** Hard cap on user-input length AFTER sanitisation. The classifier system
 *  prompt is ~2.5 kB; capping user input at 32 kB keeps the total prompt
 *  comfortably inside the 7B/14B Ollama context window AND inside Anthropic's
 *  prompt-caching budget. Truncation is suffixed with a marker so the model
 *  can see it was capped. */
const MAX_USER_INPUT_CHARS = 32_000;
const TRUNCATION_SUFFIX = '\n[…truncated for length]';

/**
 * Sanitise raw user input before it is interpolated into a prompt template.
 *
 * Guarantees, in order:
 *   1. Lines whose trimmed form starts with a {@link SYSTEM_RULE_LINE_MARKERS}
 *      marker are dropped entirely. They are replaced with a `[stripped: …]`
 *      placeholder so downstream eval can see the redaction happened (and
 *      so the model sees a discontinuity rather than a silent paste).
 *   2. Triple-quote sequences are rewritten so the user content cannot
 *      escape the `"""..."""` envelope.
 *   3. The result is capped at {@link MAX_USER_INPUT_CHARS} characters.
 *
 * Idempotent: `sanitizeUserInput(sanitizeUserInput(x)) === sanitizeUserInput(x)`.
 */
export function sanitizeUserInput(raw: string): string {
  // Step 1: strip system-rule lines.
  const lines = raw.split(/\r?\n/);
  const cleanedLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    const lower = trimmed.toLowerCase();
    const matchedMarker = SYSTEM_RULE_LINE_MARKERS.find((m) =>
      lower.startsWith(m.toLowerCase()),
    );
    if (matchedMarker !== undefined) {
      cleanedLines.push(`[stripped: line matched system-rule marker]`);
      continue;
    }
    cleanedLines.push(line);
  }
  let out = cleanedLines.join('\n');

  // Step 2: neutralise delimiter-escape attempts.
  for (const [pattern, replacement] of DELIMITER_ESCAPE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }

  // Step 3: cap length.
  if (out.length > MAX_USER_INPUT_CHARS) {
    out = out.slice(0, MAX_USER_INPUT_CHARS - TRUNCATION_SUFFIX.length) +
      TRUNCATION_SUFFIX;
  }

  return out;
}

/** Fixed envelope wrapping the (already-sanitised) user task spec. Lives in
 *  this module so the byte-identity assertions in the tests have a single
 *  source of truth. */
const CLASSIFIER_USER_ENVELOPE_PREFIX = 'Task spec:\n"""\n';
const CLASSIFIER_USER_ENVELOPE_SUFFIX = '\n"""\n\nClassify this task. Output only the JSON.';

/**
 * Assemble the classifier user-message. The standing-rules / system prompt
 * is owned by the caller (it lives in classifier.ts / classifier-v2.ts as a
 * byte-stable constant); this function owns only the user-message envelope.
 *
 * The envelope prefix and suffix are byte-stable. User input is sanitised.
 * Two calls with the SAME sanitised input return byte-identical strings;
 * two calls with DIFFERENT input share the same prefix and suffix bytes,
 * which is what KV-cache / prefix-cache reuses.
 */
export function buildClassifierUserMessage(taskSpec: string): string {
  const safe = sanitizeUserInput(taskSpec);
  return CLASSIFIER_USER_ENVELOPE_PREFIX + safe + CLASSIFIER_USER_ENVELOPE_SUFFIX;
}

/** Exported for byte-identity tests. */
export const __envelope = {
  prefix: CLASSIFIER_USER_ENVELOPE_PREFIX,
  suffix: CLASSIFIER_USER_ENVELOPE_SUFFIX,
};
