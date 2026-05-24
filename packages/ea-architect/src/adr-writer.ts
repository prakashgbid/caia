/**
 * ADR writer.
 *
 * On approval the EA Architect Agent files new ADRs to the EA Repository.
 * Numbering is monotonic — scan the repository, take max+1. Filenames use
 * a slugged title. Supersession wires both directions: the new ADR's
 * `Supersedes` field, AND the superseded ADR's `Superseded-by` field
 * (best-effort frontmatter patch — files retain their existing body).
 *
 * The operator's hard rule (per feedback-ea-agent-gates-research.md):
 * "Never approves without updating documentation."
 */

import { join } from 'node:path';

import type {
  AffectedAdr,
  EaRepository,
  FsAdapter,
  NewAdrDraft
} from './types.js';

/** Convert a title to a filesystem-safe slug. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Format an ADR id like "ADR-062" from a number. */
export function formatAdrId(n: number): string {
  return `ADR-${n.toString().padStart(3, '0')}`;
}

/** Today's date in YYYY-MM-DD form. */
function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Render the markdown body for an ADR.
 *
 * Matches the on-disk Nygard-with-CAIA-extensions template at
 * `caia-ea/templates/adr-template.md`.
 */
export function renderAdrMarkdown(
  id: number,
  draft: NewAdrDraft,
  date: Date,
  defaultDecisionMakers: NonNullable<NewAdrDraft['decisionMakers']> = 'EA Architect Agent'
): string {
  const adrId = formatAdrId(id);
  const supersedes = draft.supersedes && draft.supersedes.length > 0
    ? draft.supersedes.join(', ')
    : 'none';
  const affected = draft.affectedComponents && draft.affectedComponents.length > 0
    ? draft.affectedComponents.join(', ')
    : '(none specified)';
  const reversibility = draft.reversibility ?? 'Reversible';
  const decisionMakers = draft.decisionMakers ?? defaultDecisionMakers;
  return `# ${adrId} — ${draft.title}

- **Status:** ${draft.status}
- **Date:** ${isoDate(date)}
- **Decision-makers:** ${decisionMakers}
- **Supersedes:** ${supersedes}
- **Superseded-by:** none
- **Affected-components:** ${affected}
- **Reversibility:** ${reversibility}
- **Operator-sign-off-required:** no — filed autonomously by EA Architect Agent per ADR-015

## Context

${draft.context.trim() || '(no context provided)'}

## Decision

${draft.decision.trim() || '(no decision text provided)'}

## Consequences

${draft.consequences.trim() || '(no consequences provided)'}

## References

- Filed by: \`@caia/ea-architect\` (EA Architect Agent)
- Related: ADR-015 (creation of this agent)
`;
}

/**
 * Write a single new ADR file. Returns the path written + the assigned id.
 */
export function writeNewAdr(
  repo: EaRepository,
  draft: NewAdrDraft,
  date: Date,
  fs: FsAdapter,
  /** Optional override of the next id (mainly for test determinism). */
  forceId?: number
): { adrId: string; filePath: string; id: number } {
  const id = forceId ?? repo.maxAdrId + 1;
  const slug = slugifyTitle(draft.title) || `adr-${id}`;
  const filename = `${formatAdrId(id)}-${slug}.md`;
  const filePath = join(repo.rootPath, 'decisions', filename);
  const body = renderAdrMarkdown(id, draft, date);
  fs.writeFile(filePath, body);
  // Mutate maxAdrId so subsequent writes in the same submission don't collide.
  repo.maxAdrId = Math.max(repo.maxAdrId, id);
  return { adrId: formatAdrId(id), filePath, id };
}

/**
 * Update a superseded ADR's `Superseded-by` field. Idempotent and
 * best-effort — if the existing field is missing, the function inserts
 * one after the `Supersedes:` line; if the format isn't recognised the
 * function appends a footer note.
 */
export function markSupersededBy(
  fs: FsAdapter,
  filePath: string,
  newAdrId: string
): void {
  if (!fs.exists(filePath)) return;
  const body = fs.readFile(filePath);
  const updated = patchSupersededBy(body, newAdrId);
  if (updated !== body) {
    fs.writeFile(filePath, updated);
  }
}

export function patchSupersededBy(body: string, newAdrId: string): string {
  // Try matching "- **Superseded-by:** <value>" or "- Superseded-by: <value>".
  // The "**" pairs can appear as: "- **Superseded-by:** <value>"
  // (around the entire key+colon) or "- Superseded-by: <value>" (no emphasis).
  const re = /(-\s+\*{0,2}Superseded-by\*{0,2}:\*{0,2}\s*)([^\n]*)/i;
  if (re.test(body)) {
    return body.replace(re, (_match, prefix: string, existing: string) => {
      const existingTrim = existing.trim().replace(/\*+$/, '').trim();
      if (existingTrim === 'none' || existingTrim === '' || existingTrim === 'N/A') {
        return `${prefix}${newAdrId}`;
      }
      // Already has entries — append if not already there.
      if (existingTrim.includes(newAdrId)) return `${prefix}${existing}`;
      return `${prefix}${existing.trimEnd()}, ${newAdrId}`;
    });
  }
  // Insert after a `Supersedes:` line if present.
  const re2 = /(-\s+\*{0,2}Supersedes\*{0,2}:[^\n]*\n)/i;
  if (re2.test(body)) {
    return body.replace(re2, (match) => `${match}- **Superseded-by:** ${newAdrId}\n`);
  }
  // Fallback: append a footer note.
  return `${body.trimEnd()}\n\n---\n\n**Superseded by ${newAdrId}** (filed by EA Architect Agent).\n`;
}

/**
 * Apply a batch of supersession actions. For each affected ADR with
 * action "supersede", patch the file in place to mark it superseded by
 * each new ADR that was filed.
 *
 * The mapping is heuristic: the function pairs each affected-supersede
 * entry with each new ADR whose `supersedes` includes that adrId, OR
 * if the new ADRs were filed and they have no explicit `supersedes`
 * but the proposer named affected supersessions, we mark all new ADRs
 * as superseding all affected.
 */
export function applySupersessions(
  fs: FsAdapter,
  repo: EaRepository,
  affectedActions: AffectedAdr[],
  filedNewAdrs: { adrId: string }[]
): { adrId: string; supersededBy: string }[] {
  const out: { adrId: string; supersededBy: string }[] = [];
  for (const action of affectedActions) {
    if (action.action !== 'supersede') continue;
    const existing = repo.adrs.find((a) => a.adrId === action.adrId);
    if (existing === undefined) continue;
    // Choose the new-ADR whose `supersedes` includes this id, else first new ADR.
    for (const filed of filedNewAdrs) {
      markSupersededBy(fs, existing.filePath, filed.adrId);
      out.push({ adrId: action.adrId, supersededBy: filed.adrId });
    }
  }
  return out;
}

/**
 * Update or create the decisions/INDEX.md file appending the new ADRs.
 */
export function updateDecisionsIndex(
  fs: FsAdapter,
  repo: EaRepository,
  filed: { adrId: string; title: string; filePath: string }[]
): void {
  const indexPath = join(repo.rootPath, 'decisions', 'INDEX.md');
  const header = `# ADR Index

Auto-maintained by \`@caia/ea-architect\`. One row per ADR. Newest at the bottom.

| ADR | Title | Status |
|-----|-------|--------|
`;
  let body: string;
  if (fs.exists(indexPath)) {
    body = fs.readFile(indexPath);
    // Ensure the file looks like our table; if not, prepend.
    if (!body.includes('| ADR | Title | Status |')) {
      body = header + body;
    }
  } else {
    body = header;
  }
  for (const f of filed) {
    const row = `| [${f.adrId}](${f.filePath.split('/').pop()}) | ${escapeMd(f.title)} | Accepted |\n`;
    if (!body.includes(`| [${f.adrId}](`)) {
      body = body + row;
    }
  }
  fs.writeFile(indexPath, body);
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|');
}
