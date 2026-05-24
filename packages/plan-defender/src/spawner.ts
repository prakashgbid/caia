/**
 * The Plan Defender spawner.
 *
 * Per spec §3.3: when an EA sub-agent invokes the spawner with a submission,
 * the spawner:
 *   1. validates the accompanying context dump,
 *   2. seeds a stateful Defender handle keyed by submissionId,
 *   3. exposes `askQuestion(handle, question)` which runs the responder,
 *      persists Q & A to the dialogue log, runs the escalation detector,
 *      advances the round counter, and returns the answer + (optional)
 *      escalation.
 *
 * The spawner enforces the hard 5-round cap (§3.6) by refusing further
 * questions once `handle.round >= cap` and forcing an escalation.
 */

import { DialogueLog } from './dialogue-log.js';
import { defaultFs, type FsLike } from './fs.js';
import { detectEscalation } from './escalation-detector.js';
import { StubResponder } from './responder.js';
import { validateContextDump } from './context-dump.js';
import type {
  CONSECUTIVE_LOW_CONFIDENCE_THRESHOLD as _T,
  ContextDumpValidation,
  DefenderAnswer,
  DefenderEscalation,
  DefenderHandle,
  DefenderQuestion,
  DefenderSpawnerConfig,
  PlanContextDump,
  ResponderAdapter
} from './types.js';
import {
  DEFENDER_ITERATION_CAP,
  CONSECUTIVE_LOW_CONFIDENCE_THRESHOLD
} from './types.js';

export interface AskResult {
  answer: DefenderAnswer;
  escalation?: DefenderEscalation;
  /** True iff the handle is now closed (caller should not ask more questions). */
  closed: boolean;
}

export interface SpawnResult {
  handle: DefenderHandle;
  /** Validation of the context dump. Caller may inspect to reject thin dumps. */
  validation: ContextDumpValidation;
}

/** The Plan Defender spawner. Stateful: tracks per-submission handles. */
export class PlanDefenderSpawner {
  private readonly cap: number;
  private readonly lowThreshold: number;
  private readonly fs: FsLike;
  private readonly clock: () => Date;
  private readonly log: DialogueLog;
  private readonly responder: ResponderAdapter;
  private readonly handles = new Map<string, DefenderHandle>();
  private readonly history = new Map<string, Array<{ q: DefenderQuestion; a: DefenderAnswer }>>();

  constructor(cfg: DefenderSpawnerConfig = {}) {
    this.cap = cfg.iterationCap ?? DEFENDER_ITERATION_CAP;
    this.lowThreshold = cfg.lowConfidenceThreshold ?? CONSECUTIVE_LOW_CONFIDENCE_THRESHOLD;
    this.fs = cfg.fs ?? defaultFs;
    this.clock = cfg.clock ?? ((): Date => new Date());
    this.log = new DialogueLog({
      ...(cfg.dialogueDir !== undefined ? { dir: cfg.dialogueDir } : {}),
      fs: this.fs
    });
    this.responder = cfg.responder ?? new StubResponder();
  }

  /** Spawn a Defender for a submission. Validates the dump first. */
  spawn(submissionId: string, dump: PlanContextDump): SpawnResult {
    const validation = validateContextDump(dump);
    const handle: DefenderHandle = {
      submissionId,
      spawnedAt: this.clock().toISOString(),
      contextDump: dump,
      round: 0,
      consecutiveLowConfidence: 0,
      closed: false
    };
    this.handles.set(submissionId, handle);
    this.history.set(submissionId, []);
    return { handle, validation };
  }

  /** Look up an existing handle. */
  getHandle(submissionId: string): DefenderHandle | undefined {
    return this.handles.get(submissionId);
  }

  /** True if the Defender has been spawned for this submission. */
  isSpawned(submissionId: string): boolean {
    return this.handles.has(submissionId);
  }

  /**
   * Ask the Defender a question. Advances the round counter, persists Q & A,
   * runs the escalation detector, returns the answer + (optional) escalation.
   *
   * The handle is closed on:
   *   - cap reached (round === cap after this question)
   *   - escalation fired
   *   - explicit close() call by the Reviewer
   */
  async askQuestion(
    submissionId: string,
    questionText: string,
    opts: { scope?: string; context?: string; traceId?: string } = {}
  ): Promise<AskResult> {
    const handle = this.handles.get(submissionId);
    if (handle === undefined) {
      throw new Error(`no Defender handle for submission ${submissionId}; spawn() first`);
    }
    if (handle.closed) {
      throw new Error(
        `Defender for ${submissionId} is closed (reason: ${handle.closeReason ?? 'unknown'})`
      );
    }

    // Pre-flight: cap check. If we're already at cap, force escalation.
    if (handle.round >= this.cap) {
      const escalation = this.makeEscalation(handle, 'iteration-cap-reached', questionText, `Reached the ${this.cap}-round iteration cap. Forcing terminal escalation.`);
      this.log.appendEscalation(submissionId, escalation, opts.traceId);
      this.closeHandle(handle, 'cap-reached');
      const stubAnswer: DefenderAnswer = {
        round: handle.round + 1,
        answer: `Iteration cap reached (${this.cap} rounds). No further answers; escalating.`,
        cited_sources: [],
        confidence: 'low',
        recommended_action: 'escalate-to-operator',
        ts: this.clock().toISOString()
      };
      return { answer: stubAnswer, escalation, closed: true };
    }

    // Advance round counter.
    handle.round += 1;
    const q: DefenderQuestion = {
      round: handle.round,
      question: questionText,
      ts: this.clock().toISOString(),
      ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
      ...(opts.context !== undefined ? { context: opts.context } : {})
    };
    this.log.appendQuestion(submissionId, q, opts.traceId);

    // Pre-answer escalation detection — strategic-class questions short-circuit
    // before the responder runs (saves an LLM call).
    const history = this.history.get(submissionId) ?? [];
    const recentAnswers = history.map((h) => h.a);
    const preDetect = detectEscalation({
      question: q,
      recentAnswers,
      dump: handle.contextDump,
      consecutiveThreshold: this.lowThreshold
    });
    if (preDetect !== null && preDetect.kind === 'strategic-class-question') {
      const escalation = this.makeEscalation(handle, preDetect.kind, questionText, preDetect.note);
      this.log.appendEscalation(submissionId, escalation, opts.traceId);
      this.closeHandle(handle, 'escalated');
      const synth: DefenderAnswer = {
        round: handle.round,
        answer: preDetect.note,
        cited_sources: [],
        confidence: 'low',
        recommended_action: 'escalate-to-operator',
        notes_for_reviewer: preDetect.note,
        ts: this.clock().toISOString()
      };
      this.log.appendAnswer(submissionId, synth, opts.traceId);
      history.push({ q, a: synth });
      return { answer: synth, escalation, closed: true };
    }

    // Run the responder.
    const answer = await this.responder.respond({
      question: q,
      contextDump: handle.contextDump,
      history,
      round: handle.round
    });
    this.log.appendAnswer(submissionId, answer, opts.traceId);
    history.push({ q, a: answer });
    this.history.set(submissionId, history);

    // Confidence streak tracking.
    if (answer.confidence === 'low') {
      handle.consecutiveLowConfidence += 1;
    } else {
      handle.consecutiveLowConfidence = 0;
    }

    // Post-answer escalation detection: producer-never-decided or
    // consecutive-low-confidence. The responder itself may have already set
    // recommended_action: 'escalate-to-operator' — we honour that as well.
    if (answer.recommended_action === 'escalate-to-operator') {
      const escalation = this.makeEscalation(
        handle,
        'producer-never-decided',
        questionText,
        answer.notes_for_reviewer ?? 'Defender flagged this answer as needing operator decision.'
      );
      this.log.appendEscalation(submissionId, escalation, opts.traceId);
      this.closeHandle(handle, 'escalated');
      return { answer, escalation, closed: true };
    }

    const postDetect = detectEscalation({
      question: q,
      recentAnswers: history.map((h) => h.a),
      dump: handle.contextDump,
      consecutiveThreshold: this.lowThreshold
    });
    if (postDetect !== null) {
      const escalation = this.makeEscalation(handle, postDetect.kind, questionText, postDetect.note);
      this.log.appendEscalation(submissionId, escalation, opts.traceId);
      this.closeHandle(handle, 'escalated');
      return { answer, escalation, closed: true };
    }

    // Don't auto-close on cap here — leave the close to the next askQuestion
    // call's pre-flight check. This lets callers detect "cap reached" via the
    // returned `closed` flag without losing access to the handle for inspection.
    const closed = handle.round >= this.cap;

    return { answer, closed };
  }

  /** Explicitly close a Defender (e.g. Reviewer issued terminal verdict). */
  close(submissionId: string): void {
    const handle = this.handles.get(submissionId);
    if (handle !== undefined) this.closeHandle(handle, 'reviewer-terminated');
  }

  /** Total in-flight (not-yet-closed) Defenders. Useful for concurrency tests. */
  inFlightCount(): number {
    let n = 0;
    for (const h of this.handles.values()) if (!h.closed) n++;
    return n;
  }

  /** Snapshot of history. Useful for tests + the sign-off composer. */
  getHistory(submissionId: string): ReadonlyArray<{ q: DefenderQuestion; a: DefenderAnswer }> {
    return this.history.get(submissionId) ?? [];
  }

  /** Path of the dialogue log for a submission. */
  getDialogueLogPath(submissionId: string): string {
    return this.log.pathFor(submissionId);
  }

  /** Direct access to the dialogue log (for the Steward + sign-off composer). */
  getDialogueLog(): DialogueLog {
    return this.log;
  }

  private closeHandle(handle: DefenderHandle, reason: NonNullable<DefenderHandle['closeReason']>): void {
    handle.closed = true;
    handle.closeReason = reason;
  }

  private makeEscalation(
    handle: DefenderHandle,
    kind: DefenderEscalation['kind'],
    question: string,
    note: string
  ): DefenderEscalation {
    return {
      kind,
      round: handle.round || 0,
      question,
      note,
      ts: this.clock().toISOString()
    };
  }
}

// Suppress the unused-type warning in some toolchains.
void (0 as unknown as typeof _T);
