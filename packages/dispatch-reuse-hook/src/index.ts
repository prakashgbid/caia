/**
 * @caia/dispatch-reuse-hook — orchestrator-side helpers that inject
 * @caia/reuse-searcher results into a spawned agent's prompt before dispatch.
 *
 * Pattern:
 *   const candidates = await searchReuseCandidates(brief);
 *   const enriched = withReuseCandidates(brief, candidates);
 *   await chainRunner.dispatchPhase(ctx, phaseId, { command, args: ["--prompt", enriched] });
 *
 * Layer L3 of the reuse-first guardrail (ADR-065).
 */

import {
  searchReuseCandidates,
  type RankedCandidate,
  type SearchOptions,
} from "@caia/reuse-searcher";

/** The header that demarcates the reuse-candidates block at the top of an enriched prompt. */
export const REUSE_CANDIDATES_HEADER = "# Reuse candidates (search before you write)";

/**
 * Prepend a ranked-candidates block to the brief. The block has a stable
 * machine-parseable header so downstream tooling can detect whether the
 * brief was already enriched (idempotent).
 */
export function withReuseCandidates(brief: string, candidates: readonly RankedCandidate[]): string {
  if (brief.startsWith(REUSE_CANDIDATES_HEADER)) return brief; // idempotent
  if (candidates.length === 0) {
    return `${REUSE_CANDIDATES_HEADER}\n\nNo reuse candidates returned by @caia/reuse-searcher. Confirm with the operator before writing new code from scratch.\n\n---\n\n${brief}`;
  }
  const lines: string[] = [REUSE_CANDIDATES_HEADER, ""];
  for (const c of candidates) {
    lines.push(`- **${c.packageName}** (score ${c.matchScore})`);
    if (c.description) lines.push(`  - ${c.description}`);
    if (c.matchReasons.length > 0) lines.push(`  - Reasons: ${c.matchReasons.join("; ")}`);
  }
  lines.push("");
  lines.push(
    "For each candidate, decide: (a) consume as-is, (b) extend it (PR to that package), (c) reject with a written reason. Plans of type `implementation` MUST record the per-package decisions in `reuseSearchResults` (enforced by @caia/reuse-check-gate)."
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n") + brief;
}

/**
 * One-shot helper: search + inject in a single call. Use this when the
 * orchestrator has no other reason to hold the candidates list.
 */
export async function enrichBriefWithReuseSearch(
  brief: string,
  opts: SearchOptions = {}
): Promise<{ enrichedBrief: string; candidates: readonly RankedCandidate[] }> {
  const candidates = await searchReuseCandidates(brief, opts);
  const enrichedBrief = withReuseCandidates(brief, candidates);
  return { enrichedBrief, candidates };
}

/**
 * Detect whether a brief already carries an injected reuse-candidates block.
 * Useful for orchestrators that don't want to double-inject.
 */
export function hasReuseCandidatesBlock(brief: string): boolean {
  return brief.startsWith(REUSE_CANDIDATES_HEADER);
}

export type { RankedCandidate, SearchOptions } from "@caia/reuse-searcher";
