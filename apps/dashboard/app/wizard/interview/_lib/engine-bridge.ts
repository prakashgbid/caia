/**
 * Server-side bridge to `@caia/interviewer`.
 *
 * Subscription-only contract — all LLM dispatch goes through
 * `@chiefaia/claude-spawner` with `rejectIfApiKeyPresent: true` (the
 * exact pattern affected by the June-15-2026 Anthropic Agent SDK
 * metering change; the spawner-migration is a separate future task).
 *
 * This module is intentionally narrow: it exposes `startSession`,
 * `submitTurn`, and `markDone` — the three operations the page calls.
 * The default factories pull in the real `@caia/interviewer` runtime;
 * tests replace `createInterviewer` and `createLlm` so vitest never
 * spawns a real `claude` binary.
 *
 * Persistence target is `interview_threads` per-tenant (the
 * `InterviewerPersistence` port handles the schema routing per
 * `tenantSchemaName(tenantSlug)`).
 */

import {
  Interviewer,
  MemoryInterviewerPersistence,
  loadPlaybook,
  type LlmCaller,
  type LlmCallResult,
} from '@caia/interviewer';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { spawnClaude } from '@chiefaia/claude-spawner';

/**
 * Default subscription-only LLM caller. Routes every prompt through
 * `spawnClaude` with `rejectIfApiKeyPresent: true` so the pay-per-token
 * path is unreachable.
 */
export function createSubscriptionOnlyLlm(): LlmCaller {
  return {
    async call(prompt: string): Promise<LlmCallResult> {
      const started = Date.now();
      try {
        // Re-import lazily so the dashboard build doesn't fail if the
        // spawner package is missing at type-check time. The runtime
        // dependency is real but the call surface is narrow.
        const mod = await import('@chiefaia/claude-spawner');
        const res = await mod.spawnClaude({
          prompt,
          options: { outputFormat: 'json' as const },
          constraints: { rejectIfApiKeyPresent: true },
        });
        return {
          ok: res.ok,
          text: res.stdout ?? '',
          durationMs: Date.now() - started,
          diagnostic: res.ok ? null : res.errorReason ?? 'spawn_failed',
          modelUsed: res.modelUsed ?? 'claude-sonnet-4-6',
        };
      } catch (err) {
        return {
          ok: false,
          text: '',
          durationMs: Date.now() - started,
          diagnostic: (err as Error).message,
          modelUsed: 'unknown',
        };
      }
    },
  };
}

export interface BridgeSession {
  readonly interviewId: string;
  readonly tenantSlug: string;
}

export interface StartSessionResult {
  readonly session: BridgeSession;
  readonly agentMessage: string;
  readonly turnNumber: number;
  readonly state: string;
  readonly coverage: Record<string, number>;
}

export interface SubmitTurnResult {
  readonly agentMessage: string;
  readonly turnNumber: number;
  readonly state: string;
  readonly coverage: Record<string, number>;
  readonly satisfactionScore: number | null;
  readonly handoff: unknown;
  readonly complete: boolean;
}

export interface EngineBridgeDeps {
  /** Factory for the interviewer instance. Tests inject a stub. */
  readonly createInterviewer?: (opts: {
    tenantSlug: string;
    operatorEmail: string;
    llm: LlmCaller;
  }) => Promise<Interviewer> | Interviewer;
  /** Factory for the LLM caller. Defaults to subscription-only. */
  readonly createLlm?: () => LlmCaller;
}

// Map tenant -> interviewer instance for the lifetime of the process.
const sessionRegistry = new Map<string, Interviewer>();

export async function startSession(
  input: { tenantSlug: string; operatorEmail: string; grandIdeaPrompt: string },
  deps: EngineBridgeDeps = {},
): Promise<StartSessionResult> {
  const llm = (deps.createLlm ?? createSubscriptionOnlyLlm)();
  const interviewer = deps.createInterviewer
    ? await deps.createInterviewer({
        tenantSlug: input.tenantSlug,
        operatorEmail: input.operatorEmail,
        llm,
      })
    : new Interviewer({
        playbook: await loadPlaybook(),
        llm,
        persistence: new MemoryInterviewerPersistence(),
        tenantSlug: input.tenantSlug,
        operatorEmail: input.operatorEmail,
      });

  const start = await interviewer.start({ grandIdeaPrompt: input.grandIdeaPrompt });
  sessionRegistry.set(start.interviewId, interviewer);
  return {
    session: { interviewId: start.interviewId, tenantSlug: input.tenantSlug },
    agentMessage: start.agentMessage,
    turnNumber: start.turnNumber,
    state: start.state as string,
    coverage: snapshotCoverage(interviewer),
  };
}

export async function submitTurn(
  session: BridgeSession,
  userText: string,
): Promise<SubmitTurnResult> {
  const interviewer = sessionRegistry.get(session.interviewId);
  if (!interviewer) {
    throw new Error(`unknown interview session: ${session.interviewId}`);
  }
  const out = await interviewer.submitUserReply(userText);
  return {
    agentMessage: out.agentMessage,
    turnNumber: out.turnNumber,
    state: out.state as string,
    coverage: snapshotCoverage(interviewer),
    satisfactionScore: out.satisfactionScore ?? null,
    handoff: out.handoff ?? null,
    complete: out.state === 'HANDOFF' || out.state === 'FORCE_CLOSED',
  };
}

export async function markDone(session: BridgeSession): Promise<SubmitTurnResult> {
  const interviewer = sessionRegistry.get(session.interviewId);
  if (!interviewer) {
    throw new Error(`unknown interview session: ${session.interviewId}`);
  }
  const handoff = await interviewer.forceClose('customer', 'operator_force');
  return {
    agentMessage:
      'You marked the interview as complete. The plan is being handed off for review.',
    turnNumber: interviewer.getTurnNumber(),
    state: interviewer.getState() as string,
    coverage: snapshotCoverage(interviewer),
    satisfactionScore: null,
    handoff,
    complete: true,
  };
}

export function clearRegistryForTest(): void {
  sessionRegistry.clear();
}

function snapshotCoverage(interviewer: Interviewer): Record<string, number> {
  try {
    const snap = interviewer.snapshot();
    const cov = (snap.rubric?.perPillarCoverage ?? {}) as Record<string, number>;
    return { ...cov };
  } catch {
    return {};
  }
}
