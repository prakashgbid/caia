/**
 * Customer wizard — Step 3: Interview.
 *
 * Wires `@caia/interviewer` into a multi-turn chat experience and surfaces
 * the 16-pillar coverage radar on the right (per
 * `chiefaia-com-design-prompt.md` §6).
 *
 * Exit criteria:
 *   1. The interview engine returns `HANDOFF` (critic accepted coverage), OR
 *   2. The customer presses "I'm done" (force-close).
 *
 * Either trigger dispatches the canonical project FSM transition
 * `interviewing → interview-complete` and redirects to
 * `/wizard/architecture`.
 *
 * Auto-saves on every turn — the interviewer's `InterviewerPersistence`
 * port writes to `interview_threads` (per-tenant schema) on every state
 * change.
 *
 * Subscription-only contract: see `_lib/engine-bridge.ts`.
 *
 * Sibling-task coordination:
 *   - This route ONLY owns `apps/dashboard/app/wizard/interview/**`.
 *   - The wizard SHELL (layout + progress + state hook) is the sibling
 *     task's responsibility; we deliberately render a self-contained
 *     two-column layout so this step works in isolation while the shell
 *     is in flight.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { ChatPanel, type ChatTurn } from './_components/ChatPanel';
import { PillarRadar, type PillarId, PILLAR_IDS } from './_components/PillarRadar';
import { Card, CardContent, CardHeader } from './_components/ui';
import {
  markDoneAction,
  startSessionAction,
  submitTurnAction,
} from './actions';
import {
  dispatchFsmTransition,
  INTERVIEW_FROM,
  INTERVIEW_TO,
} from './_lib/fsm';
import type { BridgeSession } from './_lib/engine-bridge';

interface SessionState {
  readonly session: BridgeSession;
  readonly state: string;
  readonly turnNumber: number;
}

const INITIAL_GRAND_IDEA_FALLBACK =
  'Help me think through my business idea so we can scope the MVP.';

export interface InterviewWizardPageProps {
  /**
   * Tenant + operator + project IDs come from the wizard shell context.
   * We default them so the page can be rendered standalone for E2E.
   */
  readonly tenantSlug?: string;
  readonly operatorEmail?: string;
  readonly projectId?: string;
  readonly grandIdeaPrompt?: string;
  /** Override for tests — defaults to server actions. */
  readonly api?: {
    readonly start: typeof startSessionAction;
    readonly submit: typeof submitTurnAction;
    readonly done: typeof markDoneAction;
    readonly fsm: typeof dispatchFsmTransition;
  };
  /** Override for tests — defaults to next/navigation router push. */
  readonly onComplete?: (handoff: unknown) => void;
}

export default function InterviewWizardPage(props: InterviewWizardPageProps = {}) {
  const router = useRouter();
  // E2E escape hatch: if window.__caiaWizardTestApi is set the page uses
  // it instead of the real server actions. Set only by the Playwright
  // spec via page.addInitScript — undefined in production builds.
  const testApi =
    typeof window !== 'undefined'
      ? (window as unknown as { __caiaWizardTestApi?: InterviewWizardPageProps['api'] })
          .__caiaWizardTestApi
      : undefined;
  const api =
    props.api ??
    testApi ?? {
      start: startSessionAction,
      submit: submitTurnAction,
      done: markDoneAction,
      fsm: dispatchFsmTransition,
    };

  const tenantSlug = props.tenantSlug ?? 'demo-tenant';
  const operatorEmail = props.operatorEmail ?? 'customer@example.com';
  const projectId = props.projectId ?? 'demo-project';
  const grandIdeaPrompt = props.grandIdeaPrompt ?? INITIAL_GRAND_IDEA_FALLBACK;

  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [session, setSession] = React.useState<SessionState | null>(null);
  const [coverage, setCoverage] = React.useState<Partial<Record<PillarId, number>>>({});
  const [satisfaction, setSatisfaction] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [bootStarted, setBootStarted] = React.useState(false);
  const [completed, setCompleted] = React.useState(false);

  const turnIdRef = React.useRef(0);
  const nextTurnId = React.useCallback(() => {
    turnIdRef.current += 1;
    return `turn-${turnIdRef.current}`;
  }, []);

  // Boot the session on mount. Guard against React 18 strict-mode double-mount.
  React.useEffect(() => {
    if (bootStarted) return;
    setBootStarted(true);
    void (async () => {
      try {
        setBusy(true);
        const res = await api.start({ tenantSlug, operatorEmail, grandIdeaPrompt });
        setSession({
          session: res.session,
          state: res.state,
          turnNumber: res.turnNumber,
        });
        setTurns([
          {
            id: nextTurnId(),
            role: 'agent',
            content: res.agentMessage,
            turnNumber: res.turnNumber,
          },
        ]);
        setCoverage(res.coverage as Partial<Record<PillarId, number>>);
      } catch (err) {
        setError(`Failed to start interview: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    })();
  }, [api, bootStarted, grandIdeaPrompt, nextTurnId, operatorEmail, tenantSlug]);

  const finalize = React.useCallback(
    async (handoff: unknown) => {
      setCompleted(true);
      const res = await api.fsm({
        projectId,
        from: INTERVIEW_FROM,
        to: INTERVIEW_TO,
        reason: 'wizard-interview-step-exit',
      });
      // Even if the FSM endpoint is not yet wired we proceed to the next
      // step — the shell will re-reconcile on the architecture page.
      if (props.onComplete) {
        props.onComplete(handoff);
      } else {
        router.push('/wizard/architecture');
      }
      return res;
    },
    [api, projectId, props, router],
  );

  const handleSend = React.useCallback(
    async (text: string) => {
      if (!session || completed) return;
      const userId = nextTurnId();
      setTurns((prev) => [
        ...prev,
        {
          id: userId,
          role: 'user',
          content: text,
          turnNumber: session.turnNumber,
        },
      ]);
      try {
        setBusy(true);
        setError(null);
        const out = await api.submit(session.session, text);
        setSession({
          session: session.session,
          state: out.state,
          turnNumber: out.turnNumber,
        });
        setTurns((prev) => [
          ...prev,
          {
            id: nextTurnId(),
            role: 'agent',
            content: out.agentMessage,
            turnNumber: out.turnNumber,
          },
        ]);
        setCoverage(out.coverage as Partial<Record<PillarId, number>>);
        setSatisfaction(out.satisfactionScore);
        if (out.complete) {
          await finalize(out.handoff);
        }
      } catch (err) {
        setError(`Turn failed: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [api, completed, finalize, nextTurnId, session],
  );

  const handleMarkDone = React.useCallback(async () => {
    if (!session || completed) return;
    try {
      setBusy(true);
      const out = await api.done(session.session);
      setSession({
        session: session.session,
        state: out.state,
        turnNumber: out.turnNumber,
      });
      setTurns((prev) => [
        ...prev,
        {
          id: nextTurnId(),
          role: 'agent',
          content: out.agentMessage,
          turnNumber: out.turnNumber,
        },
      ]);
      await finalize(out.handoff);
    } catch (err) {
      setError(`Mark-done failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [api, completed, finalize, nextTurnId, session]);

  const coveredCount = PILLAR_IDS.filter((p) => (coverage[p] ?? 0) >= 75).length;

  return (
    <div
      data-testid="wizard-interview-page"
      data-state={session?.state ?? 'BOOTING'}
      data-completed={completed ? 'true' : 'false'}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 380px)',
        gap: 16,
        height: '100%',
        minHeight: 'calc(100vh - 120px)',
      }}
    >
      <ChatPanel
        turns={turns}
        disabled={!session || completed}
        busy={busy}
        onSend={handleSend}
        onMarkDone={handleMarkDone}
      />

      <Card data-testid="coverage-panel" style={{ height: '100%' }}>
        <CardHeader>16-pillar coverage</CardHeader>
        <CardContent>
          <div
            data-testid="coverage-summary"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 12,
              color: '#cbd5e0',
              fontSize: 13,
            }}
          >
            <span>
              <strong data-testid="coverage-count">{coveredCount}</strong> / 16 pillars at floor
            </span>
            <span>
              Satisfaction:{' '}
              <strong data-testid="satisfaction-score">
                {satisfaction === null ? '—' : satisfaction.toFixed(0)}
              </strong>
              /100
            </span>
          </div>
          <PillarRadar coverage={coverage} />
          {error ? (
            <div
              role="alert"
              data-testid="interview-error"
              style={{
                marginTop: 12,
                padding: 8,
                background: '#7f1d1d',
                color: '#fee2e2',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : null}
          {completed ? (
            <div
              data-testid="interview-completion-banner"
              style={{
                marginTop: 12,
                padding: 8,
                background: '#064e3b',
                color: '#d1fae5',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              Interview complete — advancing to information architecture…
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
