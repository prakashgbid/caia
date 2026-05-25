/**
 * Inbox surfacer — appends up to `dailyCap` candidate ADRs to the
 * operator's INBOX under `## YYYY-MM-DD — AI-FIRST-UPGRADE CANDIDATES`,
 * with dedup against the last 30 days of INBOX content.
 *
 * Dedup key = `itemUrl`.
 */
import * as path from 'node:path';

import type { CandidateAdr, FsAdapter, JudgedItem } from './types.js';

export interface SurfaceOptions {
  inboxPath: string;
  fs: FsAdapter;
  now: Date;
  dailyCap: number;
  dedupeWindowDays?: number;
}

export interface SurfaceResult {
  newEntries: number;
  cappedOut: number;
  dedupedEntries: number;
}

export function surfaceCandidates(
  judgedRelevant: JudgedItem[],
  drafts: CandidateAdr[],
  opts: SurfaceOptions,
): SurfaceResult {
  const existing = opts.fs.exists(opts.inboxPath) ? opts.fs.readFile(opts.inboxPath) : '';
  const dedupeWindowDays = opts.dedupeWindowDays ?? 30;
  const seenUrls = collectRecentUrls(existing, opts.now, dedupeWindowDays);

  let deduped = 0;
  const fresh: { judged: JudgedItem; draft: CandidateAdr | undefined }[] = [];
  for (let i = 0; i < judgedRelevant.length; i++) {
    const j = judgedRelevant[i];
    if (!j) continue;
    if (seenUrls.has(j.item.url)) { deduped++; continue; }
    fresh.push({ judged: j, draft: drafts[i] });
    seenUrls.add(j.item.url);
  }

  const capped = fresh.length > opts.dailyCap ? fresh.length - opts.dailyCap : 0;
  const surfaced = fresh.slice(0, opts.dailyCap);

  if (surfaced.length === 0) {
    return { newEntries: 0, cappedOut: capped, dedupedEntries: deduped };
  }

  const today = isoDate(opts.now);
  const block = renderBlock(today, surfaced);
  const needsLeadingNewline = existing.length > 0 && !existing.endsWith('\n');
  const prefix = existing + (needsLeadingNewline ? '\n' : '') + (existing.length > 0 ? '\n' : '');
  ensureDir(opts.fs, opts.inboxPath);
  opts.fs.writeFile(opts.inboxPath, prefix + block);
  return { newEntries: surfaced.length, cappedOut: capped, dedupedEntries: deduped };
}

const URL_LINE_RE = /^- \[.+?\]\((.+?)\)/;
const HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s+—\s+AI-FIRST-UPGRADE CANDIDATES\s*$/;

function collectRecentUrls(content: string, now: Date, windowDays: number): Set<string> {
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
  const urls = new Set<string>();
  if (content.length === 0) return urls;
  const lines = content.split('\n');
  let currentInWindow = false;
  for (const line of lines) {
    const hm = line.match(HEADING_RE);
    if (hm) {
      const dateStr = hm[1] ?? '';
      const d = new Date(dateStr + 'T00:00:00Z');
      currentInWindow = !Number.isNaN(d.getTime()) && d >= cutoff;
      continue;
    }
    if (line.startsWith('## ')) { currentInWindow = false; continue; }
    if (!currentInWindow) continue;
    const lm = line.match(URL_LINE_RE);
    if (lm && typeof lm[1] === 'string') urls.add(lm[1]);
  }
  return urls;
}

function renderBlock(date: string, surfaced: { judged: JudgedItem; draft: CandidateAdr | undefined }[]): string {
  const lines: string[] = [];
  lines.push(`## ${date} — AI-FIRST-UPGRADE CANDIDATES`);
  lines.push('');
  for (const s of surfaced) {
    const title = s.judged.item.title || s.judged.item.url;
    const url = s.judged.item.url;
    const conf = s.judged.verdict.confidence.toFixed(2);
    const draftPath = s.draft ? ` _(draft: ${s.draft.filePath})_` : '';
    lines.push(`- [${title}](${url}) — confidence ${conf}${draftPath}`);
  }
  lines.push('');
  return lines.join('\n');
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureDir(fs: FsAdapter, file: string): void {
  const dir = path.dirname(file);
  if (!fs.exists(dir)) fs.mkdirp(dir);
}
