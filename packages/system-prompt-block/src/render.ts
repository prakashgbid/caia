/**
 * Primer renderer — takes the extracted section data and produces the
 * stable markdown digest. No timestamps, no mtimes, no per-run state.
 *
 * Section ordering inside the primer:
 *   1. Standing Instructions (alphabetised inside extract)
 *   2. Architecture TOC
 *   3. 10-stage Definition of Done
 *
 * The primer is intentionally compact. Trailing whitespace is normalised;
 * line endings are LF only.
 */

const HEADER = `# CAIA Primer

You are operating inside the CAIA monorepo (multi-agent AI software
development platform). This primer is auto-generated from the standing
rules. Read it before reasoning. Detailed runbooks live in agent/memory/
and docs/ — pull what you need on demand.`;

/**
 * Render the standing-instructions section as a compact bullet list.
 * The bullets arrive already alphabetised + collapsed-to-one-line
 * from extractStandingInstructions(), so this just decorates.
 */
export function renderStandingInstructions(bullets: string[]): string {
  if (bullets.length === 0) return '';
  const items = bullets.map((b) => `- ${b}`).join('\n');
  return `## Standing Instructions (inviolate)\n\n${items}`;
}

/** Render the architecture TOC as a compact bullet list. */
export function renderArchitectureToc(tocs: string[]): string {
  if (tocs.length === 0) return '';
  const items = tocs.map((t) => `- ${t}`).join('\n');
  return `## Architecture (caia_architecture.md ToC)\n\n${items}`;
}

/** Render the DoD as a numbered list. */
export function renderDoDStages(stages: string[]): string {
  if (stages.length === 0) return '';
  const items = stages.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `## Definition of Done (10-stage)\n\n${items}`;
}

/** Stitch all sections together with a deterministic separator. */
export function renderPrimer(parts: {
  standingInstructions: string[];
  architectureToc: string[];
  dodStages: string[];
}): string {
  const sections: string[] = [HEADER];
  const si = renderStandingInstructions(parts.standingInstructions);
  if (si !== '') sections.push(si);
  const arch = renderArchitectureToc(parts.architectureToc);
  if (arch !== '') sections.push(arch);
  const dod = renderDoDStages(parts.dodStages);
  if (dod !== '') sections.push(dod);
  return sections.join('\n\n') + '\n';
}
