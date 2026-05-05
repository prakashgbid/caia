/**
 * Curator Phase-2 — backlog-directive emitter (output mode 6).
 *
 * Per `agent/memory/curator_agent_directive.md`: "Backlog directives —
 * for substantial changes (new agent, new framework adoption,
 * architecture shift), Curator files a directive memory the same way
 * this one was filed."
 *
 * The emitter writes one markdown file per directive at:
 *
 *   <reportsDir>/curator/backlog-directives/<slug>.md
 *
 * Frontmatter mirrors the existing memory-directive style (see
 * `agent/memory/curator_agent_directive.md`, `mentor_agent_directive.md`,
 * etc.) so once the operator approves the directive they can `mv` it
 * straight into `agent/memory/<slug>.md` with no edits to the
 * frontmatter — only adding the operator-supplied originSessionId
 * (which Curator can't know).
 *
 * Idempotency: existing files preserved unless `force: true`. Mirrors
 * the alarm + pr-proposal contracts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BacklogDirectiveAction, EmitResult } from './types.js';

/** Output dir resolution: `<reportsDir>/curator/backlog-directives`. */
export function defaultBacklogDirectivesDir(reportsDir: string): string {
  return join(reportsDir, 'curator', 'backlog-directives');
}

/**
 * Render a BacklogDirectiveAction as memory-directive-shaped markdown.
 *
 * Layout matches the existing CAIA memory directives so promotion to
 * `agent/memory/` is one `mv` away:
 *
 *   ---
 *   name: <title>
 *   description: <summary first line>
 *   type: curator-backlog-directive
 *   dimension: <dimension>
 *   effortEstimate: <small|medium|large|xlarge>
 *   slug: <slug>
 *   detectedAt: <iso>
 *   sourceFindings: [...]
 *   ---
 *
 *   # <title>
 *
 *   **Status**: BACKLOG — drafted by Curator (Phase-2 PR-2). Operator
 *   review required before promotion to `agent/memory/`.
 *
 *   ## Mandate
 *   <summary>
 *
 *   ## Evidence
 *   - ...
 *
 *   ## Recommended action
 *   <recommendation>
 *
 *   ## Promotion checklist
 *   - [ ] Operator reviewed evidence + recommendation
 *   - [ ] Effort estimate confirmed (current: <effort>)
 *   - [ ] Mandate-compliance reviewed (no paid services, etc.)
 *   - [ ] mv to `agent/memory/<slug>.md` after approval
 */
export function renderBacklogDirectiveMarkdown(
  action: BacklogDirectiveAction
): string {
  const summaryFirstLine = firstLine(action.summary) || action.title;
  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${yamlSafe(action.title)}`);
  lines.push(`description: ${yamlSafe(summaryFirstLine)}`);
  lines.push('type: curator-backlog-directive');
  lines.push(`dimension: ${yamlSafe(action.dimension)}`);
  lines.push(`effortEstimate: ${action.effortEstimate}`);
  lines.push(`slug: ${action.slug}`);
  lines.push(`detectedAt: ${action.detectedAt}`);
  lines.push(`sourceFindings: [${action.sourceFindings.map((s) => `"${s}"`).join(', ')}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${action.title}`);
  lines.push('');
  lines.push(
    '**Status**: BACKLOG — drafted by Curator (Phase-2 PR-2). Operator review required before promotion to `agent/memory/`.'
  );
  lines.push('');
  lines.push('## Mandate');
  lines.push('');
  lines.push(action.summary);
  lines.push('');
  if (action.evidence.length > 0) {
    lines.push('## Evidence');
    lines.push('');
    for (const e of action.evidence) lines.push(`- ${e}`);
    lines.push('');
  }
  lines.push('## Recommended action');
  lines.push('');
  lines.push(action.recommendation);
  lines.push('');
  lines.push('## Promotion checklist');
  lines.push('');
  lines.push('- [ ] Operator reviewed evidence + recommendation');
  lines.push(`- [ ] Effort estimate confirmed (current: \`${action.effortEstimate}\`)`);
  lines.push('- [ ] Mandate-compliance reviewed (subscription-only, no paid services)');
  lines.push(
    '- [ ] On approval: `mv` to `agent/memory/<slug>.md` and add `originSessionId` to frontmatter'
  );
  lines.push('');
  return lines.join('\n');
}

/** Options for `writeBacklogDirectives`. */
export interface WriteBacklogDirectivesOptions {
  /** Output directory. Defaults to `<reportsDir>/curator/backlog-directives`. */
  outDir?: string;
  /** Used to compute `outDir` if not passed. */
  reportsDir?: string;
  /** Overwrite existing files. */
  force?: boolean;
}

/** Persist BacklogDirectiveActions to disk. Returns an EmitResult. */
export function writeBacklogDirectives(
  actions: BacklogDirectiveAction[],
  opts: WriteBacklogDirectivesOptions = {}
): EmitResult {
  const dir = resolveDir(opts);
  ensureDir(dir);

  const written: EmitResult['written'] = [];
  const skipped: EmitResult['skipped'] = [];

  for (const action of actions) {
    const path = join(dir, `${action.slug}.md`);
    const exists = existsSync(path);
    if (exists && !opts.force) {
      skipped.push({ path, slug: action.slug, kind: 'backlog-directive' });
      continue;
    }
    const md = renderBacklogDirectiveMarkdown(action);
    if (exists && opts.force) {
      const current = readFileSync(path, 'utf-8');
      if (current === md) {
        skipped.push({ path, slug: action.slug, kind: 'backlog-directive' });
        continue;
      }
    }
    writeFileSync(path, md, 'utf-8');
    written.push({ path, slug: action.slug, kind: 'backlog-directive' });
  }

  return {
    outputDir: dir,
    writtenCount: written.length,
    skippedCount: skipped.length,
    written,
    skipped
  };
}

function resolveDir(opts: WriteBacklogDirectivesOptions): string {
  if (opts.outDir !== undefined) return opts.outDir;
  if (opts.reportsDir === undefined) {
    throw new Error(
      'writeBacklogDirectives: either `outDir` or `reportsDir` must be provided'
    );
  }
  return defaultBacklogDirectivesDir(opts.reportsDir);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx === -1 ? s : s.slice(0, idx);
}

function yamlSafe(s: string): string {
  if (/^[A-Za-z0-9 _\-./]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}
