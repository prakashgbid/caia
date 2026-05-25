/**
 * Inbox surfacer — appends findings to the operator's INBOX.md under
 * `## YYYY-MM-DD — memory drift` headers, with per-finding deduplication
 * against the last `dedupeWindowDays` days of INBOX content.
 *
 * Dedup key = `kind|sourceRelPath|detail-first-200ch`.
 */
import * as path from 'node:path';

import type { Finding, FsAdapter } from './types.js';

export interface SurfaceOptions {
  inboxPath: string;
  fs: FsAdapter;
  now: Date;
  dedupeWindowDays: number;
}

export interface SurfaceResult {
  newEntries: number;
  dedupedEntries: number;
  surfaced: Finding[];
}

const HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s+—\s+memory drift\s*$/gm;

export function surfaceToInbox(findings: Finding[], opts: SurfaceOptions): SurfaceResult {
  const existing = opts.fs.exists(opts.inboxPath) ? opts.fs.readFile(opts.inboxPath) : '';
  const seenKeys = collectRecentKeys(existing, opts.now, opts.dedupeWindowDays);
  const surfaced: Finding[] = [];
  let deduped = 0;
  for (const f of findings) {
    const key = dedupKey(f);
    if (seenKeys.has(key)) { deduped++; continue; }
    surfaced.push(f);
    seenKeys.add(key);
  }
  if (surfaced.length === 0) {
    return { newEntries: 0, dedupedEntries: deduped, surfaced };
  }
  const today = isoDate(opts.now);
  const block = renderBlock(today, surfaced);
  const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
  const prefix = existing + (needsLeadingNewline ? '\n' : '') + (existing.length > 0 ? '\n' : '');
  ensureDir(opts.fs, opts.inboxPath);
  opts.fs.writeFile(opts.inboxPath, prefix + block);
  return { newEntries: surfaced.length, dedupedEntries: deduped, surfaced };
}

export function dedupKey(f: Finding): string {
  return `${f.kind}|${f.sourceRelPath}|${f.detail.slice(0, 200)}`;
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function collectRecentKeys(content: string, now: Date, windowDays: number): Set<string> {
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
  const keys = new Set<string>();
  if (content.length === 0) return keys;
  const SENTINEL = '\n## __sentinel__ — end\n';
  const padded = content + SENTINEL;
  const sectionRe = /^##\s+(\d{4}-\d{2}-\d{2})\s+—\s+memory drift\s*\n([\s\S]*?)(?=^##\s)/gm;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(padded)) !== null) {
    const dateStr = m[1] ?? '';
    const body = m[2] ?? '';
    const date = new Date(dateStr + 'T00:00:00Z');
    if (Number.isNaN(date.getTime()) || date < cutoff) continue;
    for (const line of body.split('\n')) {
      const lm = line.match(/^- \[(.+?)\]\s+`(.+?)`\s+—\s+(.+)$/);
      if (!lm) continue;
      const kind = lm[1] ?? '';
      const src = lm[2] ?? '';
      const detail = lm[3] ?? '';
      keys.add(`${kind}|${src}|${detail.slice(0, 200)}`);
    }
  }
  return keys;
}

function renderBlock(date: string, surfaced: Finding[]): string {
  const lines: string[] = [];
  lines.push(`## ${date} — memory drift`);
  lines.push('');
  for (const f of surfaced) {
    lines.push(`- [${f.kind}] \`${f.sourceRelPath}\` — ${f.detail}`);
  }
  lines.push('');
  return lines.join('\n');
}

function ensureDir(fs: FsAdapter, file: string): void {
  const dir = path.dirname(file);
  if (!fs.exists(dir)) fs.mkdirp(dir);
}

// Exported for the headings-regex test.
export const __testing__ = { HEADING_RE };
