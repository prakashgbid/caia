/**
 * Failure-mode taxonomy loader.
 *
 * Reads `mentor_agent_directive.md` ## Failure-mode taxonomy section and
 * extracts the 18 categories with their human-readable descriptions. Used by
 * the LLM-reasoned tier to ground its prompt in Mentor's curated taxonomy
 * rather than hallucinating its own categories.
 *
 * Falls back to a hard-coded canonical list if the directive can't be
 * parsed (defensive — production parsing has never been observed to fail
 * but tests may inject a sparse mini-taxonomy fixture).
 */

import type { FailureModeId, FsReader, TaxonomyEntry } from './types.js';
import { ALL_FAILURE_MODES } from './types.js';

const TAXONOMY_HEADER = /^##\s+Failure-mode taxonomy/;
const NEXT_SECTION = /^##\s+/;
const NUMBERED_ENTRY = /^\d+\.\s+\*\*([^*]+)\*\*\s+—\s+(.*)$/;

/** Parse the human-readable category-name from a `**Name**` markdown bold span
 * into our kebab-case `FailureModeId`. */
export function nameToFailureModeId(name: string): FailureModeId | null {
  const norm = name.trim().toLowerCase();
  switch (norm) {
    case 'hallucination': return 'hallucination';
    case 'scope mismatch': return 'scope-mismatch';
    case 'incompleteness': return 'incompleteness';
    case 'wrong direction': return 'wrong-direction';
    case 'lacking information': return 'lacking-information';
    case 'coordination failure': return 'coordination-failure';
    case 'git/branch hygiene failure': return 'git-branch-hygiene';
    case 'cost overrun': return 'cost-overrun';
    case 'security regression': return 'security-regression';
    case 'operator confusion': return 'operator-confusion';
    case 'premature completion': return 'premature-completion';
    case 're-litigation': return 're-litigation';
    case 'decision-classifier violation': return 'decision-classifier-violation';
    case 'memory drift': return 'memory-drift';
    case 'false-modesty': return 'false-modesty';
    case 'recipe rot': return 'recipe-rot';
    case 'tool misuse': return 'tool-misuse';
    case 'ci flake masquerading as real failure': return 'ci-flake-masquerade';
    default: return null;
  }
}

/** Hard-coded fallback — used when the directive lookup fails. Mirrors
 * the kebab-case categories with stable English descriptions extracted from
 * mentor_agent_directive.md at the time this file was authored. */
export const CANONICAL_TAXONOMY: readonly TaxonomyEntry[] = Object.freeze([
  { id: 'hallucination', description: "output doesn't match reality (e.g., agent claims a file exists when it doesn't; cites a PR # that never existed)." },
  { id: 'scope-mismatch', description: "work delivered doesn't match the brief." },
  { id: 'incompleteness', description: 'Definition-of-Done not actually met.' },
  { id: 'wrong-direction', description: 'initial framing was incorrect; whole approach needed to pivot.' },
  { id: 'lacking-information', description: 'agent acted before probing enough context.' },
  { id: 'coordination-failure', description: 'parallel work clashed (worktree collision, merge thrash, dual writes).' },
  { id: 'git-branch-hygiene', description: 'orphan branch, no PR, force-push, missed back-merge, stash never cleared.' },
  { id: 'cost-overrun', description: 'subscription-bucket spike beyond budget.' },
  { id: 'security-regression', description: 'would have been a credential leak / unsafe action.' },
  { id: 'operator-confusion', description: 'operator got incorrect or misleading information from an agent.' },
  { id: 'premature-completion', description: "agent claimed done but wasn't (test wasn't actually run, file wasn't actually written, PR wasn't actually merged)." },
  { id: 're-litigation', description: 'agent re-flagged a settled topic.' },
  { id: 'decision-classifier-violation', description: 'agent presented options ("want me to / should I / your call") on a tech matter.' },
  { id: 'memory-drift', description: 'agent ignored or misapplied a relevant memory entry.' },
  { id: 'false-modesty', description: 'agent claimed "I can\'t do X" when it actually could.' },
  { id: 'recipe-rot', description: 'documented procedure no longer matches reality.' },
  { id: 'tool-misuse', description: 'agent used the wrong tier (computer-use when MCP existed; raw curl when web-fetch was right).' },
  { id: 'ci-flake-masquerade', description: 'agent treated a flake as a real bug and chased a phantom.' }
]);

export function loadTaxonomy(fs: FsReader, taxonomyPath: string): readonly TaxonomyEntry[] {
  if (!fs.exists(taxonomyPath)) return CANONICAL_TAXONOMY;
  let text: string;
  try {
    text = fs.readFile(taxonomyPath);
  } catch {
    return CANONICAL_TAXONOMY;
  }
  const parsed = parseTaxonomyMarkdown(text);
  if (parsed.length === 0) return CANONICAL_TAXONOMY;
  // Backfill any missing categories from the canonical list so callers can
  // rely on `ALL_FAILURE_MODES.length === entries.length`.
  const seen = new Set(parsed.map(e => e.id));
  const merged: TaxonomyEntry[] = [...parsed];
  for (const c of CANONICAL_TAXONOMY) {
    if (!seen.has(c.id)) merged.push(c);
  }
  // Order by canonical sequence for stable prompts.
  merged.sort((a, b) => ALL_FAILURE_MODES.indexOf(a.id) - ALL_FAILURE_MODES.indexOf(b.id));
  return Object.freeze(merged);
}

export function parseTaxonomyMarkdown(text: string): TaxonomyEntry[] {
  const lines = text.split('\n');
  let inSection = false;
  const out: TaxonomyEntry[] = [];
  for (const line of lines) {
    if (TAXONOMY_HEADER.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && NEXT_SECTION.test(line) && !TAXONOMY_HEADER.test(line)) {
      break;
    }
    if (!inSection) continue;
    const m = NUMBERED_ENTRY.exec(line);
    if (m === null) continue;
    const name = m[1] ?? '';
    const desc = m[2] ?? '';
    const id = nameToFailureModeId(name);
    if (id === null) continue;
    // strip trailing routing-clause "Routes to: ..." for prompt brevity
    const cleaned = desc.replace(/Routes to:.*$/i, '').trim();
    out.push({ id, description: cleaned });
  }
  return out;
}

/** Collapse our kebab-case id to Mentor's flattened slug form
 * (`prematurecompletion`, `relitigation`, `decisionclassifierviolation`).
 * Used when emitting events to the existing mentor-event-bus index. */
export function flattenForMentor(id: FailureModeId): string {
  return id.replace(/-/g, '');
}
