/**
 * Transcript connector — walks the local-agent-mode-sessions tree at
 * configurable depth, surfaces session folders and message files modified
 * within the window. Phase 0 only emits structural metadata (no content
 * extraction); Phase 2 will include LLM summaries.
 *
 * Heuristic kind assignment:
 *  - filenames matching /handoff|completion|done/ → 'transcript-handoff'
 *  - filenames matching /error|failure|crash|abort/ → 'transcript-failure'
 *  - everything else → 'transcript-handoff' (default; conservative)
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type {
  CollectArgs,
  Connector,
  ConnectorResult,
  Finding,
  FindingKind,
  FsReader
} from '../types.js';

export interface TranscriptConnectorOptions {
  transcriptRoot: string;
  fs: FsReader;
  /** Walk depth limit (defaults to 4 — root/session/sub/file). */
  maxDepth?: number;
  /** Max findings emitted; defaults to 200. */
  maxFindings?: number;
}

const HANDOFF_RE = /handoff|completion|done|complete/i;
const FAILURE_RE = /error|failure|crash|abort|failed/i;

export function createTranscriptConnector(opts: TranscriptConnectorOptions): Connector {
  const maxDepth = opts.maxDepth ?? 4;
  const maxFindings = opts.maxFindings ?? 200;

  return {
    source: 'transcript',
    async collect(args: CollectArgs): Promise<ConnectorResult> {
      const collectedAtIso = args.untilIso;
      const warnings: string[] = [];
      const findings: Finding[] = [];

      if (!opts.fs.exists(opts.transcriptRoot)) {
        warnings.push(`transcript: root not found at ${opts.transcriptRoot}`);
        return { source: 'transcript', findings, collectedAtIso, warnings };
      }

      const sinceMs = Date.parse(args.sinceIso);
      const untilMs = Date.parse(args.untilIso);

      const stack: { path: string; depth: number }[] = [{ path: opts.transcriptRoot, depth: 0 }];
      while (stack.length > 0 && findings.length < maxFindings) {
        const next = stack.pop();
        if (next === undefined) break;
        const { path, depth } = next;
        const st = opts.fs.stat(path);
        if (st === null) continue;

        if (st.isFile) {
          const mtimeMs = Date.parse(st.mtimeIso);
          if (Number.isNaN(mtimeMs) || mtimeMs < sinceMs || mtimeMs > untilMs) continue;
          // Ignore very small files (heuristic — empty or stub).
          if (st.sizeBytes < 32) continue;
          // Ignore files that aren't transcript-shaped — keep .md / .txt / .jsonl.
          if (!/\.(md|txt|jsonl|json|log)$/i.test(path)) continue;
          findings.push(buildTranscriptFinding(path, st.mtimeIso, st.sizeBytes));
          continue;
        }

        if (st.isDirectory) {
          if (depth >= maxDepth) continue;
          for (const entry of opts.fs.readDir(path)) {
            stack.push({ path: join(path, entry), depth: depth + 1 });
          }
        }
      }

      return { source: 'transcript', findings, collectedAtIso, warnings };
    }
  };
}

function buildTranscriptFinding(path: string, mtimeIso: string, sizeBytes: number): Finding {
  const filename = path.split('/').filter(Boolean).pop() ?? path;
  let kind: FindingKind = 'transcript-handoff';
  if (FAILURE_RE.test(filename)) kind = 'transcript-failure';
  else if (HANDOFF_RE.test(filename)) kind = 'transcript-handoff';
  // else default to handoff
  const tags: string[] = [];
  if (FAILURE_RE.test(filename)) tags.push('failure');
  if (HANDOFF_RE.test(filename)) tags.push('handoff');
  if (sizeBytes > 100_000) tags.push('large');
  const titleBase = filename.replace(/\.[a-z]+$/i, '');
  const truncated = titleBase.length > 120 ? titleBase.slice(0, 117) + '...' : titleBase;
  const idHash = createHash('sha256')
    .update(`transcript|${kind}|${path}|${mtimeIso}`)
    .digest('hex')
    .slice(0, 16);
  return {
    id: idHash,
    source: 'transcript',
    kind,
    key: path,
    title: `transcript ${kind === 'transcript-failure' ? 'failure' : 'handoff'}: ${truncated}`,
    tsIso: mtimeIso,
    importance: 0,
    tags,
    meta: { path, sizeBytes }
  };
}
