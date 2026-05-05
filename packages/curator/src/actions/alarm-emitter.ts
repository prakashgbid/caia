/**
 * Curator Phase-2 — alarm emitter (output mode 7).
 *
 * Per `agent/memory/curator_agent_directive.md`: "Alarms — for anything
 * urgent (CVE, ToS change, runaway spend trend, threshold-crossed
 * hardware capacity), Curator pings via Dispatch immediately rather
 * than waiting for the digest."
 *
 * The emitter is purely on-disk for now (Dispatch wire-up is a
 * follow-up). Each alarm becomes one markdown file at:
 *
 *   <reportsDir>/curator/alarms/<slug>.md
 *
 * Idempotency: if the file already exists, the emitter skips it
 * (preserves any operator edits in flight). Pass `force: true` to
 * overwrite. This mirrors the Mentor Phase-4 `proposeStewardRule`
 * idempotency contract — same shape so operators only learn one
 * pattern across the platform.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AlarmAction, EmitResult } from './types.js';

/**
 * Render a single AlarmAction as a markdown file body.
 *
 * Layout (must stay stable — operator runbooks reference these
 * sections by name):
 *
 *   ---
 *   type: curator-alarm
 *   severity: ...
 *   dimension: ...
 *   slug: ...
 *   detectedAt: ...
 *   sourceFindings: [...]
 *   ---
 *
 *   # <title>
 *
 *   **Severity:** <severity>  •  **Dimension:** <dimension>
 *
 *   ## Summary
 *   <summary paragraph>
 *
 *   ## Evidence
 *   - ...
 *
 *   ## Recommended action
 *   <recommendation>
 */
export function renderAlarmMarkdown(action: AlarmAction): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('type: curator-alarm');
  lines.push(`severity: ${action.severity}`);
  lines.push(`dimension: ${yamlSafe(action.dimension)}`);
  lines.push(`slug: ${action.slug}`);
  lines.push(`detectedAt: ${action.detectedAt}`);
  lines.push(`sourceFindings: [${action.sourceFindings.map((s) => `"${s}"`).join(', ')}]`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${action.title}`);
  lines.push('');
  lines.push(
    `**Severity:** ${action.severity.toUpperCase()}  •  **Dimension:** ${action.dimension}`
  );
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
  lines.push('## Recommended action');
  lines.push('');
  lines.push(action.recommendation);
  lines.push('');
  return lines.join('\n');
}

/**
 * Default alarms output directory: `<reportsDir>/curator/alarms`.
 */
export function defaultAlarmsDir(reportsDir: string): string {
  return join(reportsDir, 'curator', 'alarms');
}

/**
 * Options for `writeAlarms`.
 */
export interface WriteAlarmsOptions {
  /**
   * Output directory. Defaults to `<reportsDir>/curator/alarms`. Pass
   * an explicit value (typically only in tests) to redirect.
   */
  alarmsDir?: string;
  /**
   * Reports root — used to compute the default `alarmsDir` if not
   * passed explicitly. Required if `alarmsDir` is omitted.
   */
  reportsDir?: string;
  /** If true, overwrite existing files instead of skipping. */
  force?: boolean;
}

/**
 * Persist a list of AlarmActions to disk. Idempotent: existing files
 * are preserved unless `force: true`.
 *
 * Returns an EmitResult listing what was written + skipped.
 */
export function writeAlarms(
  actions: AlarmAction[],
  opts: WriteAlarmsOptions = {}
): EmitResult {
  const dir = resolveAlarmsDir(opts);
  ensureDir(dir);

  const written: EmitResult['written'] = [];
  const skipped: EmitResult['skipped'] = [];

  for (const action of actions) {
    const path = join(dir, `${action.slug}.md`);
    const exists = existsSync(path);
    if (exists && !opts.force) {
      skipped.push({ path, slug: action.slug, kind: 'alarm' });
      continue;
    }
    const md = renderAlarmMarkdown(action);
    if (exists && opts.force) {
      // Skip rewrite if content hasn't changed — preserves mtime.
      const current = readFileSync(path, 'utf-8');
      if (current === md) {
        skipped.push({ path, slug: action.slug, kind: 'alarm' });
        continue;
      }
    }
    writeFileSync(path, md, 'utf-8');
    written.push({ path, slug: action.slug, kind: 'alarm' });
  }

  return {
    outputDir: dir,
    writtenCount: written.length,
    skippedCount: skipped.length,
    written,
    skipped
  };
}

function resolveAlarmsDir(opts: WriteAlarmsOptions): string {
  if (opts.alarmsDir !== undefined) return opts.alarmsDir;
  if (opts.reportsDir === undefined) {
    throw new Error(
      'writeAlarms: either `alarmsDir` or `reportsDir` must be provided'
    );
  }
  return defaultAlarmsDir(opts.reportsDir);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  } else if (!existsSync(dirname(dir))) {
    mkdirSync(dirname(dir), { recursive: true });
  }
}

/**
 * Escape a string for safe inclusion as a YAML scalar value (no
 * external dep). Wraps in single quotes if it contains anything
 * unsafe.
 */
function yamlSafe(s: string): string {
  if (/^[A-Za-z0-9 _\-./]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}
