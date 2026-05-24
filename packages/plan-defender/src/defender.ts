/**
 * Convenience facade — wraps the spawner with a higher-level API that
 * lets a sub-agent treat a Defender as a per-submission object.
 *
 * Most callers should use the spawner directly; this facade is mostly
 * here for ergonomic test code + the smoke-test bootstrap.
 */

import { PlanDefenderSpawner, type AskResult, type SpawnResult } from './spawner.js';
import type {
  DefenderAnswer,
  DefenderEscalation,
  DefenderHandle,
  DefenderQuestion,
  DefenderSpawnerConfig,
  PlanContextDump
} from './types.js';

export interface DefenderSession {
  readonly submissionId: string;
  readonly handle: DefenderHandle;
  ask(question: string, opts?: { scope?: string; context?: string; traceId?: string }): Promise<AskResult>;
  close(): void;
  history(): ReadonlyArray<{ q: DefenderQuestion; a: DefenderAnswer }>;
  dialogueLogPath(): string;
}

export class PlanDefender {
  private readonly spawner: PlanDefenderSpawner;
  constructor(cfg: DefenderSpawnerConfig = {}) {
    this.spawner = new PlanDefenderSpawner(cfg);
  }

  /** Spawn a per-submission Defender session. */
  spawn(submissionId: string, dump: PlanContextDump): DefenderSession & { validation: SpawnResult['validation'] } {
    const { handle, validation } = this.spawner.spawn(submissionId, dump);
    return {
      get submissionId(): string {
        return submissionId;
      },
      get handle(): DefenderHandle {
        return handle;
      },
      ask: (q: string, opts = {}): Promise<AskResult> => this.spawner.askQuestion(submissionId, q, opts),
      close: (): void => this.spawner.close(submissionId),
      history: (): ReadonlyArray<{ q: DefenderQuestion; a: DefenderAnswer }> =>
        this.spawner.getHistory(submissionId),
      dialogueLogPath: (): string => this.spawner.getDialogueLogPath(submissionId),
      validation
    };
  }

  /** Direct spawner access. */
  getSpawner(): PlanDefenderSpawner {
    return this.spawner;
  }
}

export type { AskResult, DefenderEscalation };
