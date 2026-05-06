/**
 * Markdown section extractors.
 *
 * Each function takes a full markdown document body and returns a
 * deterministic, alphabetised, lightly-normalised representation of one
 * section. Failures to find the section throw — the codegen must
 * surface "the source file changed shape" loudly so the operator can
 * adjust either the source or the extractor.
 */

/**
 * Extract the "Standing Instructions" block from MEMORY.md.
 *
 * The section is delimited by:
 *   ## Standing Instructions (inviolate — do not delete)
 *      ... bullet list ...
 *   ##  (next H2 heading — terminates the block)
 *
 * Returns the bullets in *alphabetised* order so the primer is
 * deterministic across MEMORY.md edits that only re-order them.
 *
 * Each bullet is collapsed to a single line. Long descriptions are
 * preserved verbatim (the budget check + summariseOnOverflow handles
 * trimming separately).
 */
export function extractStandingInstructions(memoryMd: string): string[] {
  const lines = memoryMd.split('\n');
  let inSection = false;
  const bullets: string[] = [];
  let current: string | null = null;

  for (const line of lines) {
    if (/^##\s+Standing Instructions\b/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) {
      // Next section — flush + stop.
      if (current !== null) bullets.push(current);
      current = null;
      break;
    }
    if (!inSection) continue;
    if (/^\s*$/.test(line)) continue;
    if (/^\s*-\s+/.test(line)) {
      if (current !== null) bullets.push(current);
      current = line.replace(/^\s*-\s+/, '').trim();
    } else if (current !== null) {
      // Continuation of previous bullet.
      current += ' ' + line.trim();
    }
  }
  if (current !== null) bullets.push(current);

  if (bullets.length === 0) {
    throw new Error(
      'extractStandingInstructions: "## Standing Instructions" section not ' +
        'found in MEMORY.md, or section was empty. Has MEMORY.md changed shape?'
    );
  }

  // Alphabetise for deterministic ordering across edits.
  return [...bullets].sort((a, b) => a.localeCompare(b));
}

/**
 * Extract the H2 table-of-contents from caia_architecture.md.
 *
 * Returns the H2 headings in document order (NOT alphabetised — the
 * source document's own ordering is the architecturally meaningful
 * one and changes rarely). Frontmatter and H1 are skipped.
 */
export function extractArchitectureToc(architectureMd: string): string[] {
  const lines = architectureMd.split('\n');
  const tocs: string[] = [];
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && m[1]) {
      tocs.push(m[1].trim());
    }
  }
  if (tocs.length === 0) {
    throw new Error(
      'extractArchitectureToc: no `## ` headings found in ' +
        'caia_architecture.md. Has the file changed shape?'
    );
  }
  return tocs;
}

/**
 * Extract the 10-stage Definition-of-Done from the master backlog
 * sequencing doc.
 *
 * The DoD is described in the doc as a 10-stage flow. Each canonical
 * stage has one or more accepted aliases — the live source doc uses
 * slightly different phrasing than the orchestrator's task brief, so we
 * match against any alias and emit the canonical short name in the
 * primer.
 *
 * If a canonical stage cannot be found via any of its aliases, throw —
 * the source doc has drifted and the primer would be silently wrong.
 *
 * Returned in canonical pipeline order (NOT alphabetised — the order
 * is the spec).
 */
export function extractDoDStages(sequencingMd: string): string[] {
  const stagesWithAliases: Array<{ canonical: string; aliases: string[] }> = [
    { canonical: 'Analyze', aliases: ['Analyze', 'Analyse'] },
    { canonical: 'Research', aliases: ['Research'] },
    { canonical: 'Solution', aliases: ['Solution', 'Solution / Design', 'Design'] },
    { canonical: 'Implement', aliases: ['Implement'] },
    { canonical: 'Unit test', aliases: ['Unit test', 'Unit tests'] },
    {
      canonical: 'Integration test',
      aliases: ['Integration test', 'Integration tests']
    },
    { canonical: 'Deploy', aliases: ['Deploy'] },
    {
      canonical: 'E2E live verify',
      aliases: ['E2E live verify', 'End-to-end live verify', 'End to end live verify']
    },
    {
      canonical: 'Regression test',
      aliases: ['Regression test', 'Regression tests']
    },
    {
      canonical: 'Document+learn',
      aliases: ['Document+learn', 'Document + capture learnings', 'Document + learn']
    }
  ];

  const found: string[] = [];
  const missing: string[] = [];
  for (const { canonical, aliases } of stagesWithAliases) {
    if (aliases.some((a) => sequencingMd.includes(a))) {
      found.push(canonical);
    } else {
      missing.push(canonical);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `extractDoDStages: missing ${missing.length} of 10 canonical DoD ` +
        `stages in sequencing doc — has the spec drifted? Missing: ` +
        missing.join(', ')
    );
  }

  return found;
}
