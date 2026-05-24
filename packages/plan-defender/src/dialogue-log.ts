/**
 * JSONL dialogue log persistence.
 *
 * The log is the canonical audit trail for a submission (spec §3.5). Every
 * Q&A round is appended as a single JSON line. Append-only and crash-safe:
 * new rounds never rewrite prior ones.
 *
 * The log is the input the EA Doc Steward consumes when auto-filing ADRs,
 * and is embedded verbatim in the sign-off document by the Coordinator.
 */

import { join } from 'node:path';

import type { FsLike } from './fs.js';
import { defaultFs } from './fs.js';
import type {
  DefenderAnswer,
  DefenderEscalation,
  DefenderQuestion,
  DialogueLogEntry
} from './types.js';

const DEFAULT_DIALOGUE_DIR = process.env['HOME']
  ? join(process.env['HOME'], 'Documents', 'projects', 'caia-ea', 'dialogues')
  : '/tmp/caia-ea/dialogues';

export interface DialogueLogConfig {
  /** Directory the .jsonl files live in. */
  dir?: string;
  fs?: FsLike;
}

export class DialogueLog {
  private readonly fs: FsLike;
  private readonly dir: string;

  constructor(cfg: DialogueLogConfig = {}) {
    this.fs = cfg.fs ?? defaultFs;
    this.dir = cfg.dir ?? DEFAULT_DIALOGUE_DIR;
  }

  /** Absolute path of the log file for a submission. */
  pathFor(submissionId: string): string {
    return join(this.dir, `${submissionId}.jsonl`);
  }

  /** Append a question. */
  appendQuestion(submissionId: string, q: DefenderQuestion, traceId?: string): void {
    const entry: DialogueLogEntry = {
      ...q,
      from: 'ea-plan-reviewer',
      to: 'plan-defender',
      entry_kind: 'question',
      submission_id: submissionId,
      ...(traceId !== undefined ? { trace_id: traceId } : {})
    };
    this.appendLine(submissionId, entry);
  }

  /** Append an answer. */
  appendAnswer(submissionId: string, a: DefenderAnswer, traceId?: string): void {
    const entry: DialogueLogEntry = {
      ...a,
      from: 'plan-defender',
      to: 'ea-plan-reviewer',
      entry_kind: 'answer',
      submission_id: submissionId,
      ...(traceId !== undefined ? { trace_id: traceId } : {})
    };
    this.appendLine(submissionId, entry);
  }

  /** Append an escalation. */
  appendEscalation(submissionId: string, e: DefenderEscalation, traceId?: string): void {
    const entry: DialogueLogEntry = {
      ...e,
      from: 'plan-defender',
      entry_kind: 'escalation',
      submission_id: submissionId,
      ...(traceId !== undefined ? { trace_id: traceId } : {})
    };
    this.appendLine(submissionId, entry);
  }

  /** Read all entries for a submission, in chronological order. */
  read(submissionId: string): DialogueLogEntry[] {
    const path = this.pathFor(submissionId);
    if (!this.fs.exists(path)) return [];
    const content = this.fs.readFile(path);
    const lines = content.split('\n').filter((l) => l.length > 0);
    const out: DialogueLogEntry[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as DialogueLogEntry);
      } catch {
        // Skip malformed lines — log is meant to be append-only but tolerate corruption.
      }
    }
    return out;
  }

  /** True iff the log file exists. */
  exists(submissionId: string): boolean {
    return this.fs.exists(this.pathFor(submissionId));
  }

  private appendLine(submissionId: string, entry: DialogueLogEntry): void {
    const line = JSON.stringify(entry) + '\n';
    this.fs.appendFile(this.pathFor(submissionId), line);
  }
}

/** Partition the log into rounds. */
export function partitionLogByRound(
  entries: DialogueLogEntry[]
): Array<{ round: number; question?: DefenderQuestion; answer?: DefenderAnswer; escalation?: DefenderEscalation }> {
  const byRound = new Map<number, { round: number; question?: DefenderQuestion; answer?: DefenderAnswer; escalation?: DefenderEscalation }>();
  for (const e of entries) {
    const round = (e as { round?: number }).round ?? 0;
    let bucket = byRound.get(round);
    if (bucket === undefined) {
      bucket = { round };
      byRound.set(round, bucket);
    }
    if (e.entry_kind === 'question') bucket.question = e;
    else if (e.entry_kind === 'answer') bucket.answer = e;
    else if (e.entry_kind === 'escalation') bucket.escalation = e;
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}
