/**
 * Curator Phase-2 — PR-proposal emitter (output mode 5).
 *
 * Per `agent/memory/curator_agent_directive.md`: "PR proposals — for
 * low-risk mechanical upgrades (dependency bumps with security fixes,
 * config tunings backed by metrics, dead-code removal), Curator opens
 * a PR through the standard Evidence Gate."
 *
 * The emitter writes one markdown file per PR-proposal at:
 *
 *   <reportsDir>/curator/pr-proposals/<slug>.md
 *
 * The markdown is Evidence-Gate-shaped: it includes the standard
 * sections (summary, evidence, affected files, recommended branch
 * name, operator-review checklist, mandate-compliance footer) so the
 * operator can copy-paste it into a real PR description with minimal
 * edits.
 *
 * Idempotency: existing files preserved unless `force: true`. Mirrors
 * the alarm-emitter contract.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EmitResult, PrProposalAction } from './types.js';

/** Output dir resolution: `<reportsDir>/curator/pr-proposals`. */
export function defaultPrProposalsDir(reportsDir: string): string {
  return join(reportsDir, 'curator', 'pr-proposals');
}

/**
 * Render a PrProposalAction as Evidence-Gate-shaped markdown. Layout:
 *
 *   ---
 *   type: curator-pr-proposal
 *   slug: ...
 *   branchSuffix: ...
 *   detectedAt: ...
 *   sourceFindings: [...]
 *   affectedPaths: [...]
 *   ---
 *
 *   # <title>
 *
 *   ## Summary
 *   <summary>
 *
 *   ## Evidence
 *   - ...
 *
 *   ## Suggested branch + affected files
 *   - branch: chore/curator-<branchSuffix>
 *   - affected paths: <list or "TBD">
 *
 *   ## Recommended action
 *   <recommendation>
 *
 *   ## Operator-review checklist
 *   - [ ] Confirm change is low-risk + mechanical
 *   - [ ] Tests still green after applying
 *   - [ ] No subscription-bucket impact
 *   - [ ] Evidence Gate green
 */
export function renderPrProposalMarkdown(action: PrProposalAction): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('type: curator-pr-proposal');
  lines.push(`slug: ${action.slug}`);
  lines.push(`branchSuffix: ${action.branchSuffix}`);
  lines.push(`detectedAt: ${action.detectedAt}`);
  lines.push(`sourceFindings: [${action.sourceFindings.map((s) => `"${s}"`).join(', ')}]`);
  lines.push(
    `affectedPaths: [${action.affectedPaths.map((s) => `"${s}"`).join(', ')}]`
  );
  lines.push('---');
  lines.push('');
  lines.push(`# ${action.title}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(action.summary);
  lines.push('');
  if (action.evidence.length > 0) {
    lines.push('## Evidence');
    lines.push('');
    for (const e of action.evidence) lines.push(`- ${e}`);
    lines.push('');
  }
  lines.push('## Suggested branch + affected files');
  lines.push('');
  lines.push(`- Branch: \`chore/curator-${action.branchSuffix}\``);
  if (action.affectedPaths.length > 0) {
    lines.push('- Affected paths:');
    for (const p of action.affectedPaths) lines.push(`  - \`${p}\``);
  } else {
    lines.push('- Affected paths: _TBD — operator to confirm before opening PR._');
  }
  lines.push('');
  lines.push('## Recommended action');
  lines.push('');
  lines.push(action.recommendation);
  lines.push('');
  lines.push('## Operator-review checklist');
  lines.push('');
  lines.push('- [ ] Change is low-risk + mechanical (dependency bump, config tune, dead-code removal)');
  lines.push('- [ ] All tests still green after applying');
  lines.push('- [ ] No new paid services introduced (subscription-bucket compliance)');
  lines.push('- [ ] Evidence Gate (gitleaks + semgrep + steward-gatekeeper) passes');
  lines.push('- [ ] No `gh pr update-branch` use (rebase + force-push only)');
  lines.push('');
  return lines.join('\n');
}

/** Options for `writePrProposals`. */
export interface WritePrProposalsOptions {
  /** Output directory. Defaults to `<reportsDir>/curator/pr-proposals`. */
  outDir?: string;
  /** Used to compute `outDir` if not passed. */
  reportsDir?: string;
  /** Overwrite existing files. */
  force?: boolean;
}

/** Persist PrProposalActions to disk. Returns an EmitResult. */
export function writePrProposals(
  actions: PrProposalAction[],
  opts: WritePrProposalsOptions = {}
): EmitResult {
  const dir = resolveDir(opts);
  ensureDir(dir);

  const written: EmitResult['written'] = [];
  const skipped: EmitResult['skipped'] = [];

  for (const action of actions) {
    const path = join(dir, `${action.slug}.md`);
    const exists = existsSync(path);
    if (exists && !opts.force) {
      skipped.push({ path, slug: action.slug, kind: 'pr-proposal' });
      continue;
    }
    const md = renderPrProposalMarkdown(action);
    if (exists && opts.force) {
      const current = readFileSync(path, 'utf-8');
      if (current === md) {
        skipped.push({ path, slug: action.slug, kind: 'pr-proposal' });
        continue;
      }
    }
    writeFileSync(path, md, 'utf-8');
    written.push({ path, slug: action.slug, kind: 'pr-proposal' });
  }

  return {
    outputDir: dir,
    writtenCount: written.length,
    skippedCount: skipped.length,
    written,
    skipped
  };
}

function resolveDir(opts: WritePrProposalsOptions): string {
  if (opts.outDir !== undefined) return opts.outDir;
  if (opts.reportsDir === undefined) {
    throw new Error(
      'writePrProposals: either `outDir` or `reportsDir` must be provided'
    );
  }
  return defaultPrProposalsDir(opts.reportsDir);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
