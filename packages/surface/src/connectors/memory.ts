/**
 * Memory connector — reads `git log --name-status --since` against the
 * agent-memory repo, classifies each touched file as added/updated, and
 * returns Finding[].
 *
 * Falls back to filesystem mtime walk when git-log fails (e.g. agent-memory
 * isn't a git repo on this machine yet).
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type {
  CollectArgs,
  Connector,
  ConnectorResult,
  Finding,
  FindingKind,
  FsReader,
  GitRunner
} from '../types.js';

export interface MemoryConnectorOptions {
  corpusRoot: string;
  memoryGitRepo: string;
  fs: FsReader;
  git: GitRunner;
}

export function createMemoryConnector(opts: MemoryConnectorOptions): Connector {
  return {
    source: 'memory',
    async collect(args: CollectArgs): Promise<ConnectorResult> {
      const collectedAtIso = args.untilIso;
      const warnings: string[] = [];

      // Try git log first.
      const gitFindings = await tryGitLog(opts, args, warnings);
      if (gitFindings !== null) {
        return { source: 'memory', findings: gitFindings, collectedAtIso, warnings };
      }

      // Fallback: filesystem walk + mtime.
      const fsFindings = walkMtime(opts, args, warnings);
      return { source: 'memory', findings: fsFindings, collectedAtIso, warnings };
    }
  };
}

interface ParsedCommit {
  iso: string;
  changes: ReadonlyArray<{ status: string; path: string }>;
}

async function tryGitLog(
  opts: MemoryConnectorOptions,
  args: CollectArgs,
  warnings: string[]
): Promise<readonly Finding[] | null> {
  if (!opts.fs.exists(opts.memoryGitRepo)) {
    warnings.push(`memory-git: repo not found at ${opts.memoryGitRepo}`);
    return null;
  }
  let stdout: string;
  try {
    stdout = await opts.git.log(opts.memoryGitRepo, [
      `--since=${args.sinceIso}`,
      `--until=${args.untilIso}`,
      '--name-status',
      '--date=iso-strict',
      '--pretty=format:--%H--%aI--',
      '--',
      // Restrict path scope to the corpus root inside the repo. We pass the
      // absolute corpusRoot — git resolves it relative to repo root via -C.
      opts.corpusRoot
    ]);
  } catch (e) {
    warnings.push(`memory-git: ${(e as Error).message.slice(0, 200)}`);
    return null;
  }

  const commits = parseGitLog(stdout);
  if (commits.length === 0) return [];

  // Aggregate per-file: latest status wins, latest commit ts is the finding ts.
  const perFile = new Map<string, { iso: string; status: string }>();
  for (const c of commits) {
    for (const ch of c.changes) {
      const prev = perFile.get(ch.path);
      if (prev === undefined || Date.parse(c.iso) > Date.parse(prev.iso)) {
        perFile.set(ch.path, { iso: c.iso, status: ch.status });
      }
    }
  }

  const findings: Finding[] = [];
  for (const [path, info] of perFile) {
    const kind: FindingKind = info.status === 'A' ? 'memory-added' : 'memory-updated';
    findings.push(buildMemoryFinding(path, info.iso, kind));
  }
  return findings;
}

function walkMtime(
  opts: MemoryConnectorOptions,
  args: CollectArgs,
  warnings: string[]
): readonly Finding[] {
  if (!opts.fs.exists(opts.corpusRoot)) {
    warnings.push(`memory-fs: corpusRoot not found at ${opts.corpusRoot}`);
    return [];
  }
  const sinceMs = Date.parse(args.sinceIso);
  const untilMs = Date.parse(args.untilIso);
  const findings: Finding[] = [];
  const entries = opts.fs.readDir(opts.corpusRoot);
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const fullPath = join(opts.corpusRoot, name);
    const st = opts.fs.stat(fullPath);
    if (st === null || !st.isFile) continue;
    const mtimeMs = Date.parse(st.mtimeIso);
    if (Number.isNaN(mtimeMs) || mtimeMs < sinceMs || mtimeMs > untilMs) continue;
    findings.push(buildMemoryFinding(name, st.mtimeIso, 'memory-updated'));
  }
  return findings;
}

export function parseGitLog(stdout: string): readonly ParsedCommit[] {
  if (stdout.trim() === '') return [];
  const commits: ParsedCommit[] = [];
  // Split on commit boundary marker "--<hash>--<iso>--".
  const lines = stdout.split('\n');
  let current: { hash: string; iso: string; changes: { status: string; path: string }[] } | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === '') continue;
    if (line.startsWith('--') && line.endsWith('--')) {
      const stripped = line.slice(2, -2);
      const dashIdx = stripped.indexOf('--');
      if (dashIdx === -1) continue;
      const hash = stripped.slice(0, dashIdx);
      const iso = stripped.slice(dashIdx + 2);
      if (current !== null) commits.push({ iso: current.iso, changes: current.changes });
      current = { hash, iso, changes: [] };
    } else if (current !== null) {
      // name-status line: "<status>\t<path>"
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) continue;
      const status = line.slice(0, tabIdx).trim();
      const path = line.slice(tabIdx + 1).trim();
      if (status === '' || path === '') continue;
      current.changes.push({ status: status[0] ?? 'M', path });
    }
  }
  if (current !== null) commits.push({ iso: current.iso, changes: current.changes });
  return commits;
}

function buildMemoryFinding(path: string, tsIso: string, kind: FindingKind): Finding {
  const filename = path.split('/').filter(Boolean).pop() ?? path;
  const tags: string[] = [];
  if (filename.startsWith('feedback_')) tags.push('feedback');
  if (filename.startsWith('apprentice_')) tags.push('apprentice');
  if (filename.startsWith('mentor_')) tags.push('mentor');
  if (filename.startsWith('curator_')) tags.push('curator');
  if (filename.startsWith('librarian_')) tags.push('librarian');
  if (filename.startsWith('stolution_')) tags.push('stolution');
  if (/_complete[._]/.test(filename) || filename.endsWith('_complete.md')) tags.push('complete');
  if (filename.includes('_live_')) tags.push('live');
  if (filename.includes('_directive')) tags.push('directive');
  if (filename === 'MEMORY.md') tags.push('index');
  const idHash = createHash('sha256')
    .update(`memory|${kind}|${path}|${tsIso}`)
    .digest('hex')
    .slice(0, 16);
  return {
    id: idHash,
    source: 'memory',
    kind,
    key: path,
    title: `${filename} ${kind === 'memory-added' ? 'added' : 'updated'}`,
    tsIso,
    importance: 0,
    tags,
    meta: { path, filename }
  };
}
