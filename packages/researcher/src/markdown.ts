/**
 * Markdown report assembly — DESIGN.md §4.
 *
 * Pure function: takes the verified raw synthesis + source/precedent lists +
 * diagnostics, emits the canonical CAIA-shape markdown body. The shape mirrors
 * the four canonical reports:
 *
 *   1. Title + metadata block (query, depth, generated)
 *   2. Executive summary
 *   3. Bottom-line recommendation
 *   4. Sub-questions covered
 *   5. Each section
 *   6. Prior CAIA precedent surfaced (if any)
 *   7. Sources (footnote-style bibliography)
 *   8. Diagnostics block
 */

import type {
  PrecedentInjection,
  RawSynthesis,
  ReportDiagnostics,
  ResearchSource
} from './types.js';

export interface AssembleMarkdownInput {
  query: string;
  depth: string;
  generatedAtIso: string;
  durationMs: number;
  raw: RawSynthesis;
  sources: readonly ResearchSource[];
  precedent: readonly PrecedentInjection[];
  subQuestions: readonly string[];
  diagnostics: ReportDiagnostics;
}

export function assembleMarkdown(input: AssembleMarkdownInput): string {
  const lines: string[] = [];
  const verdictLabel: Record<string, string> = {
    adopt: 'ADOPT',
    pilot: 'PILOT',
    track: 'TRACK',
    reject: 'REJECT'
  };
  lines.push(`# Research report — ${input.query}`);
  lines.push('');
  lines.push(
    `**Generated**: ${input.generatedAtIso} · **Depth**: ${input.depth} · **Duration**: ${(
      input.durationMs / 1000
    ).toFixed(1)}s`
  );
  lines.push(
    `**Verdict**: ${verdictLabel[input.raw.recommendation.verdict] ?? input.raw.recommendation.verdict.toUpperCase()} · **Confidence**: ${input.raw.recommendation.confidence}`
  );
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Executive summary');
  lines.push('');
  lines.push(input.raw.executiveSummary.trim());
  lines.push('');
  lines.push('## 2. Bottom-line recommendation');
  lines.push('');
  lines.push(`**Verdict**: ${input.raw.recommendation.verdict}`);
  lines.push(`**Confidence**: ${input.raw.recommendation.confidence}`);
  lines.push('');
  lines.push(`**Rationale**: ${input.raw.recommendation.rationale.trim()}`);
  lines.push('');
  if (input.raw.recommendation.nextSteps.length > 0) {
    lines.push('**Next steps**:');
    lines.push('');
    for (const step of input.raw.recommendation.nextSteps) {
      lines.push(`- ${step}`);
    }
    lines.push('');
  }
  lines.push('## 3. Sub-questions covered');
  lines.push('');
  input.subQuestions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q}`);
  });
  lines.push('');
  // Section bodies — number from 4 onward.
  let sectionNo = 4;
  for (const sec of input.raw.sections) {
    lines.push(`## ${sectionNo}. ${sec.heading}`);
    lines.push('');
    lines.push(sec.body.trim());
    lines.push('');
    sectionNo++;
  }
  if (input.precedent.length > 0) {
    lines.push(`## ${sectionNo}. Prior CAIA precedent surfaced`);
    lines.push('');
    for (const p of input.precedent) {
      lines.push(
        `- **${p.slug}** (similarity ${p.similarity.toFixed(2)}) — ${p.path}`
      );
    }
    lines.push('');
    sectionNo++;
  }
  lines.push(`## ${sectionNo}. Sources`);
  lines.push('');
  for (const src of input.sources) {
    lines.push(
      `[^${src.id}]: [${src.title}](${src.url}) (${src.trust}, fetched ${src.fetchedAtIso})`
    );
  }
  lines.push('');
  sectionNo++;
  lines.push(`## ${sectionNo}. Diagnostics`);
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(input.diagnostics, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}
