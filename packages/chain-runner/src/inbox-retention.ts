// H-40 (chain-runner-battle-harden phase 11, 2026-05-14). INBOX retention.
// The chain-watchdog INBOX.md grows unboundedly as alerts are appended over
// time. This helper splits it: alerts older than `--days` are moved into
// a per-month archive file (INBOX_archive/<yyyy-mm>.md) so the live INBOX
// stays small enough for an operator to scan.
//
// Format expected: each alert is a markdown H2 block led by an ISO-8601
// timestamp inside the heading text. The detection pattern matches both
// formats currently emitted:
//   "## YYYY-MM-DDTHH:MM:SSZ — <title>"            (wake_emit_alert)
//   "## [YYYY-MM-DDTHH:MM:SS.<ms>Z] <type> — ..."  (watchdog.js inbox fallback)
// Any block whose heading lacks a parseable ISO timestamp is preserved
// in the live INBOX (better safe than archive-and-lose-context).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_RETENTION_DAYS = 7;

// Any H2 heading is a candidate alert block. We separately try to parse an
// ISO timestamp out of the heading — a heading without a parseable
// timestamp still becomes a block (so its body isn't accidentally folded
// into the next block), and pruneInbox preserves it in the live INBOX.
const H2_HEADING = /^##\s/;
const TS_IN_HEADING = /\[?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]?/;

export interface PruneInboxOptions {
  /** Path to the INBOX.md file. */
  inboxPath: string;
  /** Days of retention. Alerts older than this are archived. */
  days?: number;
  /**
   * Directory where archive files are written. Defaults to
   * `<dirname(inboxPath)>/INBOX_archive`.
   */
  archiveDir?: string;
  /** Override "now" for tests — defaults to Date.now(). */
  now?: Date;
}

export interface AlertBlock {
  /** First line (the heading). */
  heading: string;
  /** Timestamp parsed from the heading; null when unparseable. */
  ts: Date | null;
  /** Full text (heading + following lines until next H2). */
  body: string;
}

export interface PruneInboxResult {
  inbox_path: string;
  /** Total H2 alert blocks scanned. */
  scanned: number;
  /** Blocks kept in INBOX.md. */
  kept: number;
  /** Blocks archived (by archive file path). */
  archived: Record<string, number>;
  /** Bytes written to archive files (sum). */
  archive_bytes: number;
  /** Whether INBOX.md was rewritten (false when nothing pruned). */
  rewrote_inbox: boolean;
}

/**
 * Parse an INBOX.md file into discrete alert blocks. Any preamble before
 * the first H2 heading (e.g. "# Chain-Watchdog INBOX") is returned via
 * `preamble` and preserved verbatim on rewrite.
 */
export function parseInbox(text: string): { preamble: string; blocks: AlertBlock[] } {
  const lines = text.split('\n');
  const blocks: AlertBlock[] = [];
  const preambleLines: string[] = [];
  let current: AlertBlock | null = null;
  let inPreamble = true;
  for (const line of lines) {
    if (H2_HEADING.test(line)) {
      if (current) {
        blocks.push(current);
      }
      const m = TS_IN_HEADING.exec(line);
      const tsRaw = m?.[1] ?? null;
      let ts: Date | null = null;
      if (tsRaw) {
        const iso = tsRaw.endsWith('Z') ? tsRaw : `${tsRaw}Z`;
        const d = new Date(iso);
        ts = Number.isFinite(d.getTime()) ? d : null;
      }
      current = { heading: line, ts, body: line };
      inPreamble = false;
      continue;
    }
    if (current) {
      current.body += `\n${line}`;
    } else if (inPreamble) {
      preambleLines.push(line);
    }
  }
  if (current) blocks.push(current);
  // Trim trailing blank lines from preamble for cleaner rewrites.
  while (
    preambleLines.length > 0 &&
    preambleLines[preambleLines.length - 1]!.trim() === ''
  ) {
    preambleLines.pop();
  }
  const preamble =
    preambleLines.length > 0 ? `${preambleLines.join('\n')}\n` : '';
  return { preamble, blocks };
}

function archiveFilenameFor(date: Date): string {
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${yyyy}-${mm}.md`;
}

export function pruneInbox(opts: PruneInboxOptions): PruneInboxResult {
  const days = opts.days ?? DEFAULT_RETENTION_DAYS;
  const now = opts.now ?? new Date();
  const archiveDir = opts.archiveDir ?? join(dirname(opts.inboxPath), 'INBOX_archive');
  const result: PruneInboxResult = {
    inbox_path: opts.inboxPath,
    scanned: 0,
    kept: 0,
    archived: {},
    archive_bytes: 0,
    rewrote_inbox: false,
  };
  if (!existsSync(opts.inboxPath)) return result;
  const text = readFileSync(opts.inboxPath, 'utf8');
  const { preamble, blocks } = parseInbox(text);
  result.scanned = blocks.length;
  if (blocks.length === 0) return result;
  const cutoffMs = now.getTime() - days * 86400 * 1000;
  const keep: AlertBlock[] = [];
  const archive: AlertBlock[] = [];
  for (const block of blocks) {
    if (block.ts && block.ts.getTime() < cutoffMs) {
      archive.push(block);
    } else {
      keep.push(block);
    }
  }
  result.kept = keep.length;
  if (archive.length === 0) return result;
  // Group archived blocks by month (UTC).
  const byMonth = new Map<string, AlertBlock[]>();
  for (const block of archive) {
    if (!block.ts) continue;
    const key = archiveFilenameFor(block.ts);
    const arr = byMonth.get(key) ?? [];
    arr.push(block);
    byMonth.set(key, arr);
  }
  mkdirSync(archiveDir, { recursive: true });
  for (const [filename, monthBlocks] of byMonth) {
    const path = join(archiveDir, filename);
    const existingPreamble = existsSync(path) ? '' : `# INBOX archive — ${filename.replace('.md', '')}\n\n`;
    const append = monthBlocks.map((b) => b.body.trimEnd()).join('\n\n') + '\n';
    const writeText = existingPreamble + append;
    if (existsSync(path)) {
      // Append to existing archive — read + concat preserves headers.
      const prev = readFileSync(path, 'utf8');
      const sep = prev.endsWith('\n') ? '' : '\n';
      writeFileSync(path, `${prev}${sep}${append}`);
    } else {
      writeFileSync(path, writeText);
    }
    result.archived[filename] = monthBlocks.length;
    result.archive_bytes += Buffer.byteLength(writeText, 'utf8');
  }
  // Rewrite INBOX.md with preamble + kept blocks only.
  const rewrite =
    preamble +
    (keep.length > 0
      ? keep.map((b) => b.body.trimEnd()).join('\n\n') + '\n'
      : '');
  writeFileSync(opts.inboxPath, rewrite);
  result.rewrote_inbox = true;
  return result;
}
