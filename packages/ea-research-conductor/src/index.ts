/**
 * @caia/ea-research-conductor — public surface.
 *
 * Initiates EA-led research, tracks it in a research log, dedups against
 * existing repo content, and dispatches a researcher subagent via
 * @chiefaia/claude-spawner.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4.4.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { defaultFsAdapter, type FsAdapter } from '@caia/ea-architect';

import { DedupChecker } from './dedup-check.js';
import { createClaudeDispatcher, StubDispatcher } from './dispatcher.js';
import { ResearchLog, slugify } from './research-log.js';
import type {
  DedupCheckResult,
  ResearchConductorConfig,
  ResearchDispatchVerdict,
  ResearchDispatcherAdapter,
  ResearchRequest
} from './types.js';

const DEFAULT_REPO_PATH = join(homedir(), 'Documents', 'projects', 'caia-ea');

export class EaResearchConductor {
  private readonly repoRoot: string;
  private readonly fs: FsAdapter;
  private readonly clock: () => Date;
  private readonly dispatcher: ResearchDispatcherAdapter;
  private readonly dedup: DedupChecker;
  private readonly log: ResearchLog;

  constructor(cfg: ResearchConductorConfig = {}) {
    this.repoRoot = cfg.repositoryPath ?? DEFAULT_REPO_PATH;
    this.fs = cfg.fs ?? defaultFsAdapter;
    this.clock = cfg.clock ?? ((): Date => new Date());
    this.dispatcher = cfg.dispatcher ?? createClaudeDispatcher();
    this.dedup = new DedupChecker(this.repoRoot, this.fs);
    this.log = new ResearchLog(this.repoRoot, this.fs);
  }

  /** Check whether a topic is already covered by existing research/ADR/lesson. */
  dedupCheck(topic: string): DedupCheckResult {
    return this.dedup.check(topic);
  }

  /** Initiate research — dedup-check first; dispatch if novel; log either way. */
  async request(request: ResearchRequest): Promise<ResearchDispatchVerdict> {
    const topicSlug = slugify(request.topic);
    const now = this.clock();
    const dedup = this.dedup.check(request.topic);
    const logPath = this.log.appendDispatch(topicSlug, request, now);
    if (dedup.isDuplicate) {
      return {
        topicSlug,
        dispatched: false,
        logPath,
        skippedReason: dedup.reason,
        dispatchedAtIso: now.toISOString()
      };
    }
    const result = await this.dispatcher.dispatch({ topicSlug, request });
    return {
      topicSlug,
      dispatched: result.ok,
      logPath,
      ...(result.ok ? {} : { skippedReason: result.diagnostic ?? 'dispatcher failed' }),
      dispatchedAtIso: now.toISOString()
    };
  }
}

export { DedupChecker } from './dedup-check.js';
export { ResearchLog, slugify } from './research-log.js';
export { createClaudeDispatcher, StubDispatcher } from './dispatcher.js';
export type {
  ResearchRequest,
  ResearchDispatchVerdict,
  ResearchConductorConfig,
  ResearchDispatcherAdapter,
  DedupCheckResult
} from './types.js';
