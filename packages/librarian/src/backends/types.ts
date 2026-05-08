/**
 * @chiefaia/librarian backend types — shared surface for the
 * pluggable retrieval backends introduced by validation decision #4
 * (operator-approved 2026-05-06).
 *
 * Two backends are supported:
 *
 *   - `'sqlite-vec'`  (default) — Librarian Phase-1's existing
 *     better-sqlite3 + JS-side cosine implementation. Named
 *     `'sqlite-vec'` in the user-facing flag for consistency with the
 *     campaign brief; the actual implementation does NOT use the
 *     sqlite-vec extension.
 *
 *   - `'mem0'` — Mem0 OSS Node.js (`mem0ai/oss`). Configured with
 *     `infer: false` (no LLM round-trip) + Ollama embedder + `'memory'`
 *     vector-store provider (which is misleadingly named — it is
 *     actually better-sqlite3 + JS-side cosine, with a different
 *     schema from Librarian Phase-1).
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
 * The user-facing backend choice flag. `'sqlite-vec'` is the
 * Librarian Phase-1 default; `'mem0'` is the new Mem0-backed option
 * shipped per validation decision #4.
 */
export type LibrarianBackendName = 'sqlite-vec' | 'mem0';

/**
 * Default backend when callers don't supply one. Stays `'sqlite-vec'`
 * for backwards compatibility until A/B parity is confirmed and the
 * operator explicitly approves a default-flip.
 */
export const DEFAULT_BACKEND: LibrarianBackendName = 'sqlite-vec';

/**
 * Type guard for the runtime CLI parser. Returns true if `v` is a
 * known backend name; false otherwise.
 */
export function isLibrarianBackendName(v: unknown): v is LibrarianBackendName {
  return v === 'sqlite-vec' || v === 'mem0';
}
