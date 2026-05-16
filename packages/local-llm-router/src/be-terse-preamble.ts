// GC-1 (be-terse-preamble, 2026-05-15) — input-side response-token compression.
//
// Companion to R-3 (template-token-leak) on the SAME prompt-assembly seam,
// but coming at the budget from the other side: R-3 stabilised + sanitised
// the USER message so KV-cache reuse and prompt-injection are bounded.
// GC-1 stabilises + tightens the SYSTEM-prompt preamble so the model
// produces a smaller response.
//
// Background — output bytes are the next-most-expensive thing after input
// tokens. Even with caveman-output post-processing stripping
// preamble/recap/filler from completed responses (see caveman-output.ts),
// the model still spends tokens producing them. Asking the model up-front
// to skip the boilerplate is strictly cheaper than asking it to produce
// the boilerplate and stripping after.
//
// The instruction is intentionally short and load-bearing:
//
//   1. "Be terse" — the meta-rule.
//   2. "answer in the minimum text that satisfies the task" — operational.
//   3. "skip prefatory acknowledgements" — the most common slack source.
//   4. "skip trailing recap" — the second-most-common slack source.
//
// We deliberately do NOT enumerate every banned phrase (caveman-output's
// regex list handles that on the output side as a safety net). The
// model-side instruction is small enough to live in the prefix-cache
// without measurable cost.
//
// Acceptance: ≥40% avg response-token reduction on the 25-prompt
// held-out sample (see tests/be-terse-preamble.test.ts). Measured against
// a baseline of Claude responses produced WITHOUT the preamble, using
// estimateTokens() from @chiefaia/prompt-optimizer.

/**
 * Canonical be-terse preamble injected into every claude-bound system
 * prompt. Byte-stable: the value MUST NOT vary per call so it can live in
 * the prefix-cache. Tests pin this constant.
 */
export const BE_TERSE_INSTRUCTION =
  'Be terse. Answer in the minimum text that satisfies the task. Skip prefatory acknowledgements ("Sure!", "Certainly", "Here\'s..."). Skip trailing recap ("Let me know if...", "Hope this helps"). No filler ("As you can see", "Basically"). Output only what the task asks for.';

/** Separator placed between the be-terse instruction and the caller's
 *  system prompt. Two newlines (paragraph break) so the model treats the
 *  two as separate sections. Byte-stable. */
const PREAMBLE_SEPARATOR = '\n\n';

/**
 * Configuration for the be-terse preamble injector. All options are
 * optional; the defaults are the production-correct settings.
 */
export interface BeTerseOptions {
  /** Force the injector disabled. Defaults to env BE_TERSE_PREAMBLE_DISABLE === '1'. */
  disabled?: boolean;
  /** Override the canonical instruction. Tests use this to assert byte-identity. */
  instruction?: string;
}

/** Read the env kill-switch lazily so tests can flip it between calls. */
function envDisabled(): boolean {
  return process.env['BE_TERSE_PREAMBLE_DISABLE'] === '1';
}

/**
 * Inject the be-terse preamble into a system prompt.
 *
 * Behaviour:
 *   - If `disabled` (constructor or env), return the input unchanged.
 *   - If the input already starts with the canonical instruction
 *     (idempotency check), return unchanged. Prevents double-injection
 *     when callers compose multiple preamble layers.
 *   - If the input is undefined or empty, return the instruction alone
 *     (the model still gets the terseness guidance).
 *   - Otherwise prepend `<instruction>\n\n<systemPrompt>`.
 *
 * Idempotent: `injectBeTerse(injectBeTerse(x)) === injectBeTerse(x)`.
 *
 * Byte-stable: identical input → identical output, byte-for-byte. The
 * caller can pin this in tests.
 */
export function injectBeTerse(
  systemPrompt: string | undefined,
  opts: BeTerseOptions = {},
): string {
  const disabled = opts.disabled ?? envDisabled();
  const instruction = opts.instruction ?? BE_TERSE_INSTRUCTION;

  if (disabled) {
    return systemPrompt ?? '';
  }

  const base = systemPrompt ?? '';
  if (base.length === 0) {
    return instruction;
  }

  // Idempotency: avoid double-injection.
  if (base.startsWith(instruction)) {
    return base;
  }

  return instruction + PREAMBLE_SEPARATOR + base;
}

/**
 * Strip the be-terse preamble from a string, if present. Useful for
 * tests that compare a transformed system prompt against the original.
 * Returns the input unchanged when no preamble was injected.
 */
export function stripBeTerse(
  systemPrompt: string,
  opts: Pick<BeTerseOptions, 'instruction'> = {},
): string {
  const instruction = opts.instruction ?? BE_TERSE_INSTRUCTION;
  if (systemPrompt.startsWith(instruction + PREAMBLE_SEPARATOR)) {
    return systemPrompt.slice((instruction + PREAMBLE_SEPARATOR).length);
  }
  if (systemPrompt === instruction) {
    return '';
  }
  return systemPrompt;
}

/** Exported for byte-identity tests. */
export const __beTerse = {
  separator: PREAMBLE_SEPARATOR,
};
