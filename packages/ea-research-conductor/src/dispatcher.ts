/**
 * Research dispatcher — production wraps @chiefaia/claude-spawner.
 *
 * The dispatcher is fire-and-track, not synchronous: it spawns the
 * researcher subagent and returns immediately. Research outputs land on
 * disk in research/<topic-slug>.md (which then becomes a candidate
 * EA-review submission of its own).
 */

import { spawnClaude } from '@chiefaia/claude-spawner';

import type { ResearchDispatcherAdapter, ResearchRequest } from './types.js';

export interface ClaudeDispatcherConfig {
  binaryPath?: string;
  timeoutMs?: number;
}

export function createClaudeDispatcher(cfg: ClaudeDispatcherConfig = {}): ResearchDispatcherAdapter {
  return {
    async dispatch(input: { topicSlug: string; request: ResearchRequest }): Promise<{ ok: boolean; sessionId?: string; diagnostic?: string }> {
      const prompt = `You are the EA-led researcher. Investigate the following topic and produce a research markdown at ~/Documents/projects/research/${input.topicSlug}.md plus a context dump at ~/Documents/projects/research/.context-dumps/${input.topicSlug}.json.\n\n## Topic\n${input.request.topic}\n\n## Brief\n${input.request.brief}\n\n## Requester\n${input.request.requesterAgentId}\n\nPriority: ${input.request.priority ?? 'medium'}\n\nFollow CAIA research conventions: executive verdict, problem statement, structured findings, citations, open questions. The output will be fed back through @caia/ea-architect for review.`;
      const result = await spawnClaude({
        prompt,
        options: {
          ...(cfg.binaryPath !== undefined ? { binaryPath: cfg.binaryPath } : {}),
          timeoutMs: cfg.timeoutMs ?? 300_000
        }
      });
      const out: { ok: boolean; sessionId?: string; diagnostic?: string } = {
        ok: result.ok
      };
      if (typeof (result as { sessionId?: string }).sessionId === 'string') {
        out.sessionId = (result as { sessionId?: string }).sessionId as string;
      }
      if (typeof result.diagnostic === 'string') out.diagnostic = result.diagnostic;
      return out;
    }
  };
}

/** Stub dispatcher for tests — records dispatches without spawning. */
export class StubDispatcher implements ResearchDispatcherAdapter {
  public dispatches: Array<{ topicSlug: string; request: ResearchRequest }> = [];
  async dispatch(input: { topicSlug: string; request: ResearchRequest }): Promise<{ ok: boolean; sessionId?: string }> {
    this.dispatches.push(input);
    return { ok: true, sessionId: `stub-session-${this.dispatches.length}` };
  }
}
