/**
 * Curator Phase-2 — industry-briefing emitter (output mode 8).
 *
 * Per `agent/memory/curator_agent_directive.md`: "Industry briefings —
 * for genuinely-relevant new tech (model release, framework drop), a
 * one-pager: what it is, what it'd change for us, recommended action."
 *
 * The emitter writes one markdown file per briefing at:
 *
 *   <reportsDir>/curator/industry-briefings/<slug>.md
 *
 * Briefings come from the operator-curated watchlist (loaded via
 * `loadWatchlist` from `watchlist.ts`), NOT from the metric-driven
 * scanner findings. Idempotency contract is the same as the other
 * three emitters: existing files preserved unless `force: true`;
 * force-rewrite is content-aware (no-op if unchanged).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EmitResult, IndustryBriefingAction } from './types.js';

/** Output dir resolution: `<reportsDir>/curator/industry-briefings`. */
export function defaultIndustryBriefingsDir(reportsDir: string): string {
  return join(reportsDir, 'curator', 'industry-briefings');
}

/**
 * Render an IndustryBriefingAction as one-pager markdown. Layout
 * mirrors the directive's "what it is, what it'd change for us,
 * recommended action" structure:
 *
 *   ---
 *   type: curator-industry-briefing
 *   topic: ...
 *   sourceUrl: ...        (omitted if not provided)
 *   slug: ...
 *   detectedAt: ...
 *   ---
 *
 *   # <title>
 *
 *   ## What it is
 *   <summary>
 *
 *   ## Source
 *   - <sourceUrl> (if provided)
 *
 *   ## Evidence
 *   - ...   (if any)
 *
 *   ## What it'd change for us
 *   <recommendation>
 *
 *   ## Recommended action
 *   <recommendation closing line>
 */
export function renderIndustryBriefingMarkdown(
  action: IndustryBriefingAction
): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('type: curator-industry-briefing');
  lines.push(`topic: ${yamlSafe(action.topic)}`);
  if (action.sourceUrl !== undefined) {
    lines.push(`sourceUrl: ${yamlSafe(action.sourceUrl)}`);
  }
  lines.push(`slug: ${action.slug}`);
  lines.push(`detectedAt: ${action.detectedAt}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${action.title}`);
  lines.push('');
  lines.push('## What it is');
  lines.push('');
  lines.push(action.summary);
  lines.push('');
  if (action.sourceUrl !== undefined) {
    lines.push('## Source');
    lines.push('');
    lines.push(`- ${action.sourceUrl}`);
    lines.push('');
  }
  if (action.evidence.length > 0) {
    lines.push('## Evidence');
    lines.push('');
    for (const e of action.evidence) lines.push(`- ${e}`);
    lines.push('');
  }
  lines.push("## What it'd change for us / Recommended action");
  lines.push('');
  lines.push(action.recommendation);
  lines.push('');
  return lines.join('\n');
}

/** Options for `writeIndustryBriefings`. */
export interface WriteIndustryBriefingsOptions {
  /** Output directory. Defaults to `<reportsDir>/curator/industry-briefings`. */
  outDir?: string;
  /** Used to compute `outDir` if not passed. */
  reportsDir?: string;
  /** Overwrite existing files. */
  force?: boolean;
}

/** Persist IndustryBriefingActions to disk. Returns an EmitResult. */
export function writeIndustryBriefings(
  actions: IndustryBriefingAction[],
  opts: WriteIndustryBriefingsOptions = {}
): EmitResult {
  const dir = resolveDir(opts);
  ensureDir(dir);

  const written: EmitResult['written'] = [];
  const skipped: EmitResult['skipped'] = [];

  for (const action of actions) {
    const path = join(dir, `${action.slug}.md`);
    const exists = existsSync(path);
    if (exists && !opts.force) {
      skipped.push({ path, slug: action.slug, kind: 'industry-briefing' });
      continue;
    }
    const md = renderIndustryBriefingMarkdown(action);
    if (exists && opts.force) {
      const current = readFileSync(path, 'utf-8');
      if (current === md) {
        skipped.push({ path, slug: action.slug, kind: 'industry-briefing' });
        continue;
      }
    }
    writeFileSync(path, md, 'utf-8');
    written.push({ path, slug: action.slug, kind: 'industry-briefing' });
  }

  return {
    outputDir: dir,
    writtenCount: written.length,
    skippedCount: skipped.length,
    written,
    skipped
  };
}

function resolveDir(opts: WriteIndustryBriefingsOptions): string {
  if (opts.outDir !== undefined) return opts.outDir;
  if (opts.reportsDir === undefined) {
    throw new Error(
      'writeIndustryBriefings: either `outDir` or `reportsDir` must be provided'
    );
  }
  return defaultIndustryBriefingsDir(opts.reportsDir);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function yamlSafe(s: string): string {
  if (/^[A-Za-z0-9 _\-./:?=&%]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}
