import type { LooseBacklogItem, Machine } from './types.js';

/**
 * Parse a "loose backlog line" — the single-line shape callers can pipe into
 * the CLI:
 *
 *   <id> :: <title> :: <description>            (simple)
 *   <id> :: <title> :: <description> [machine=m1] [file=path/a.ts,path/b.ts]
 *
 * Tokens after the third `::` are key=value annotations. Recognised:
 *   - machine = m3 | m1 | stolution
 *   - file    = comma-separated file_paths
 *   - deps    = comma-separated chain ids
 *
 * Free-form annotations are ignored. The parser is forgiving — bad annotations
 * are dropped rather than failing the parse.
 */
export function parseBacklogLine(line: string): LooseBacklogItem {
  const trimmed = line.trim();
  if (trimmed.length === 0) throw new Error('parseBacklogLine: empty input');

  // Split into [id, title, descPlusAnnots]
  const parts = trimmed.split('::').map((s) => s.trim());
  if (parts.length < 3) {
    throw new Error(
      `parseBacklogLine: expected "id :: title :: description" (got ${parts.length} segments). ` +
        `Example: 'my-item :: Short title :: What this does and why'`,
    );
  }
  const id = parts[0] ?? '';
  const title = parts[1] ?? '';
  // Anything after the 3rd :: is still description (so :: in description is OK)
  const descRaw = parts.slice(2).join(' :: ');

  // Extract annotations. Annotations stay embedded in the description text
  // because grep + LLM context still benefit from the extra words; we just
  // record their values for explicit fields.
  const annotRe = /(\b\w+)=([^\s][^\s]*)/g;
  const annotations: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = annotRe.exec(descRaw)) !== null) {
    const k = m[1];
    const v = m[2];
    if (k && v) annotations[k.toLowerCase()] = v;
  }
  const description = descRaw.trim();

  const out: LooseBacklogItem = { id, title, description };
  const machine = annotations.machine;
  if (machine && ['m3', 'm1', 'stolution'].includes(machine)) {
    out.machine = machine as Machine;
  }
  const file = annotations.file;
  if (file) {
    out.file_paths = file.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  const deps = annotations.deps;
  if (deps) {
    out.deps = deps.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return out;
}
