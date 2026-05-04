/**
 * YAML loader for the process graph.
 *
 * Reads every *.yaml file in the given directory, validates each against
 * `ProcessSchema`, and returns the array of validated processes.
 *
 * Files in a `proposed/` subdirectory are NOT loaded — they're staged for
 * operator review (per the process-upgrader design, P8). To activate a
 * proposed process, move the YAML file out of `proposed/` into the parent.
 *
 * Reference: devops-steward-agent-design-2026-05-03.md §3.2 + §7.3.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import { ProcessSchema, validateProcessGraph, type Process } from './process-graph.js';

export interface LoadResult {
  processes: Process[];
  errors: Array<{ path: string; error: string }>;
}

/**
 * Load every *.yaml file in `dir` (top-level only; `proposed/` is skipped).
 *
 * Files that fail Zod validation are NOT thrown — they're collected in
 * `errors` so the daemon can log them and continue with the valid set.
 */
export async function loadProcessGraph(dir: string): Promise<LoadResult> {
  const entries = await readdir(dir, { withFileTypes: true });
  const yamlFiles = entries
    .filter((e) => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')))
    .map((e) => join(dir, e.name));

  const processes: Process[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  for (const path of yamlFiles) {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = YAML.parse(raw) as unknown;
      const result = ProcessSchema.safeParse(parsed);
      if (!result.success) {
        errors.push({ path, error: `schema: ${result.error.message}` });
        continue;
      }
      try {
        validateProcessGraph(result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ path, error: `validation: ${message}` });
        continue;
      }
      processes.push(result.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ path, error: `read: ${message}` });
    }
  }

  return { processes, errors };
}
