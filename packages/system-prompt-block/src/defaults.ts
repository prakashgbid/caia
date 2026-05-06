/**
 * CAIA defaults for the parameterised generateCaiaPrimer() entry point.
 *
 * Per Option E shape (standing rule 2026-05-06), every CAIA-specific
 * path/topic/registry is a constructor parameter with a CAIA default.
 * These defaults live in a separate module so the generator core can be
 * tested against fixture paths without ever importing them.
 *
 * The runtime resolution from "~" to the operator's HOME and from the
 * relative session-id path to an absolute path is the caller's
 * responsibility (CLI does this, Mentor's pre-spawn-injection callsite
 * does this). The defaults remain symbolic so the package itself never
 * needs to know which OS user it's running as.
 */

/** Default path to the operator's session-memory MEMORY.md. */
export const DEFAULT_MEMORY_INDEX_PATH =
  '~/Library/Application Support/Claude/local-agent-mode-sessions/<session-id>/agent/memory/MEMORY.md';

/** Default path to caia_architecture.md in the same session memory. */
export const DEFAULT_ARCHITECTURE_DOC_PATH =
  '~/Library/Application Support/Claude/local-agent-mode-sessions/<session-id>/agent/memory/caia_architecture.md';

/** Default path to the master backlog sequencing doc with the 10-stage DoD. */
export const DEFAULT_DOD_SOURCE_PATH =
  '~/Library/Application Support/Claude/local-agent-mode-sessions/<session-id>/agent/memory/master_backlog_sequencing_2026-05-05.md';

/** Default token budget. ≤1K tokens per the standing rule. */
export const DEFAULT_TOKEN_BUDGET = 1000;
