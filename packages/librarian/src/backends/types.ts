/**
 * @chiefaia/librarian backend types — shared surface for the
 * pluggable retrieval backends introduced by validation decision #4
 * (operator-approved 2026-05-06).
 *
 * Two backends are supported:
 *
 *   - `'sqlite-vec'` — Librarian Phase-1's existing better-sqlite3 +
 *     JS-side cosine implementation. Named `'sqlite-vec'` in the
 *     user-facing flag for consistency with the campaign brief; the
 *     actual implementation does NOT use the sqlite-vec extension.
 *     Retained as an opt-in for tests and rollback.
 *
 *   - `'mem0'`  (default since Phase 2 default-flip, 2026-05-08) —
 *     Mem0 OSS Node.js (`mem0ai/oss`). Configured with `infer: false`
 *     (no LLM round-trip) + Ollama embedder + `'memory'` vector-store
 *     provider (which is misleadingly named — it is actually
 *     better-sqlite3 + JS-side cosine, with a different schema from
 *     Librarian Phase-1).
 *
 * Both backends honour the same hard constraints from
 * `feedback_no_api_key_billing.md` — no Anthropic API key, no OpenAI
 * API key, no per-token billing. Embeddings come from a local Ollama
 * daemon (`nomic-embed-text` by default).
 *
 * Markdown remains source of truth in both backends. The vector store
 * is purely an index; if it corrupts or is lost, rebuild from
 * `agent/memory/*.md` + `~/Documents/projects/reports/*.md`.
 */

/**
 * The user-facing backend choice flag. `'mem0'` is the
 * default since the Phase 2 default-flip on 2026-05-08 (operator
 * "scaling forward" authorization, per
 * `feedback_validation_decisions_2026-05-06.md`). `'sqlite-vec'` is
 * kept available as an opt-in fallback / rollback.
 */
export type LibrarianBackendName = 'sqlite-vec' | 'mem0';

/**
 * Default backend when callers don't supply one. Flipped from
 * `'sqlite-vec'` to `'mem0'` on 2026-05-08 after the A/B harness
 * (PR #370) confirmed Mem0 won 7/10 vs sqlite-vec's 3/10 on the live
 * 286-file CAIA corpus, with latency well under the 1-2 sec
 * pre-spawn budget. Re-evaluation triggers documented in
 * `feedback_validation_decisions_2026-05-06.md` (decision #4).
 */
export const DEFAULT_BACKEND: LibrarianBackendName = 'mem0';

/**
 * Type guard for the runtime CLI parser. Returns true if `v` is a
 * known backend name; false otherwise.
 */
export function isLibrarianBackendName(v: unknown): v is LibrarianBackendName {
  return v === 'sqlite-vec' || v === 'mem0';
}
