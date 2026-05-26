'use client';
/**
 * `<InterviewerChat>` — multi-turn Q&A surface for Step 3 — Interview.
 *
 * Drives the conversation by POSTing each user reply to
 * `/api/wizard/interview/answer` and rendering the returned next
 * question. Surfaces the 16-pillar coverage via the sibling
 * `<PillarCoverage>` component. Offers an "I'm done" CTA that hits
 * `/api/wizard/interview/complete` once the aggregate score crosses the
 * threshold (or the customer accepts the operator-override forced
 * close).
 *
 * Reuse-first compliance:
 *   - UI: `@caia/ui` primitives only (Card, Button, Input, Progress,
 *     Badge, ScrollArea). No raw shadcn/Radix imports.
 *   - Wraps `<PillarCoverage>` (also `@caia/ui`-only).
 *
 * Shape:
 *   - First mount → POST with no `response` → render turn-1 question.
 *   - User types + submits → POST with `response` → render next question
 *     + updated pillar coverage.
 *   - Customer clicks "I'm done" → POST to /complete; on 412 (coverage
 *     below threshold) show the operator-override checkbox.
 *
 * Test ergonomics:
 *   - `fetchImpl?: typeof fetch` lets tests swap the network.
 *   - `onAdvanced?` hook fires when the FSM transition lands.
 *   - All meaningful nodes have stable `data-testid` attributes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  ScrollArea,
} from '@caia/ui';
import { PillarCoverage } from './PillarCoverage';

export interface InterviewerChatQaPair {
  readonly turn: number;
  readonly role: 'agent' | 'user';
  readonly content: string;
}

export interface InterviewerChatPillarEntry {
  readonly score: number;
  readonly hits: number;
  readonly lastTouchedTurn: number;
}

export interface InterviewerChatProps {
  projectId: string;
  /** Override the global fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Optional callback after FSM advance succeeds. */
  onAdvanced?: (info: { state: string }) => void;
  /** Optional pre-seeded history (test fixtures / SSR rehydration). */
  initialHistory?: ReadonlyArray<InterviewerChatQaPair>;
  /** Optional pre-seeded pillar coverage (test fixtures). */
  initialPillarCoverage?: Readonly<Record<string, InterviewerChatPillarEntry>>;
}

interface AnswerEnvelope {
  ok: true;
  threadId: string;
  turn: number;
  nextQuestion: {
    id: string;
    pillar: string;
    text: string;
    rationale: string;
  } | null;
  aggregateScore: number;
  meetsThreshold: boolean;
  exhausted: boolean;
  pillarCoverage: Record<string, InterviewerChatPillarEntry>;
  source: 'memory' | 'live';
}

type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

export function InterviewerChat(props: InterviewerChatProps): React.JSX.Element {
  const { projectId, fetchImpl, onAdvanced, initialHistory, initialPillarCoverage } = props;
  const fetchFn = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const [history, setHistory] = useState<InterviewerChatQaPair[]>(() =>
    initialHistory ? [...initialHistory] : [],
  );
  const [pillarCoverage, setPillarCoverage] = useState<
    Record<string, InterviewerChatPillarEntry>
  >(() => (initialPillarCoverage ? { ...initialPillarCoverage } : {}));
  const [pendingQuestion, setPendingQuestion] = useState<AnswerEnvelope['nextQuestion'] | null>(
    null,
  );
  const [aggregateScore, setAggregateScore] = useState<number>(0);
  const [meetsThreshold, setMeetsThreshold] = useState<boolean>(false);
  const [exhausted, setExhausted] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>('');
  const [answerStatus, setAnswerStatus] = useState<LoadStatus>({ kind: 'idle' });
  const [completeStatus, setCompleteStatus] = useState<LoadStatus>({ kind: 'idle' });
  const [advanced, setAdvanced] = useState<boolean>(false);
  const [showForceOverride, setShowForceOverride] = useState<boolean>(false);
  const [forceChecked, setForceChecked] = useState<boolean>(false);

  const startedRef = useRef<boolean>(false);

  const applyEnvelope = useCallback(
    (env: AnswerEnvelope, appendUserTurn?: { turn: number; content: string }) => {
      setPendingQuestion(env.nextQuestion);
      setAggregateScore(env.aggregateScore);
      setMeetsThreshold(env.meetsThreshold);
      setExhausted(env.exhausted);
      setPillarCoverage(env.pillarCoverage);
      setHistory((prev) => {
        const next = appendUserTurn
          ? [...prev, { turn: appendUserTurn.turn, role: 'user' as const, content: appendUserTurn.content }]
          : [...prev];
        if (env.nextQuestion) {
          const alreadyAsked = next.some(
            (p) => p.role === 'agent' && p.content === env.nextQuestion!.text,
          );
          if (!alreadyAsked) {
            next.push({
              turn: env.turn,
              role: 'agent',
              content: env.nextQuestion.text,
            });
          }
        }
        return next;
      });
    },
    [],
  );

  const callAnswer = useCallback(
    async (response: string | null) => {
      setAnswerStatus({ kind: 'loading' });
      try {
        const res = await fetchFn('/api/wizard/interview/answer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId, ...(response ? { response } : {}) }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const env = (await res.json()) as AnswerEnvelope;
        applyEnvelope(env, response ? { turn: env.turn - 1, content: response } : undefined);
        setAnswerStatus({ kind: 'idle' });
      } catch (err) {
        setAnswerStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [applyEnvelope, fetchFn, projectId],
  );

  // First mount: kick off the thread.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (initialHistory && initialHistory.length > 0) {
      // Pre-seeded — surface the last agent turn as the pending question.
      const lastAgent = [...initialHistory].reverse().find((p) => p.role === 'agent');
      if (lastAgent) {
        setPendingQuestion({
          id: `seed-${lastAgent.turn}`,
          pillar: 'B1',
          text: lastAgent.content,
          rationale: '',
        });
      }
      return;
    }
    void callAnswer(null);
  }, [callAnswer, initialHistory]);

  const submitAnswer = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft('');
    void callAnswer(text);
  }, [callAnswer, draft]);

  const callComplete = useCallback(
    async (force: boolean) => {
      setCompleteStatus({ kind: 'loading' });
      try {
        const res = await fetchFn('/api/wizard/interview/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId, force }),
        });
        if (res.status === 412) {
          // Coverage below threshold — surface force override.
          setShowForceOverride(true);
          setCompleteStatus({
            kind: 'error',
            message: 'Coverage below threshold. Use override to advance anyway.',
          });
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as { state?: string };
        setCompleteStatus({ kind: 'idle' });
        setAdvanced(true);
        onAdvanced?.({ state: body.state ?? 'interview-complete' });
      } catch (err) {
        setCompleteStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [fetchFn, onAdvanced, projectId],
  );

  const handleComplete = useCallback(() => {
    void callComplete(showForceOverride && forceChecked);
  }, [callComplete, forceChecked, showForceOverride]);

  return (
    <Card data-testid="wizard-step-interview">
      <CardHeader>
        <CardTitle>Step 3 — Interview</CardTitle>
        <CardDescription>
          The Interviewer asks structured questions across 16 pillars. Answer
          each one in your own words; the system tracks coverage and tells you
          when you&apos;ve given it enough to advance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge variant="secondary" data-testid="interview-aggregate-score">
                aggregate {aggregateScore} / 100
              </Badge>
              {meetsThreshold && (
                <Badge data-testid="interview-meets-threshold">ready to advance</Badge>
              )}
              {exhausted && (
                <Badge variant="secondary" data-testid="interview-exhausted">
                  question bank exhausted
                </Badge>
              )}
            </div>
            <Progress
              value={aggregateScore}
              max={100}
              aria-label="interview coverage"
            />

            <ScrollArea
              className="interviewer-history"
              data-testid="interview-history"
              style={{
                marginTop: 16,
                maxHeight: 360,
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 12,
              }}
            >
              {history.length === 0 ? (
                <div style={{ fontSize: 13, opacity: 0.6 }}>Loading first question…</div>
              ) : (
                history.map((p, idx) => (
                  <div
                    key={`${p.turn}-${p.role}-${idx}`}
                    data-testid={`history-${p.role}-${p.turn}`}
                    style={{
                      marginBottom: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: p.role === 'agent' ? '#f1f5f9' : '#dbeafe',
                    }}
                  >
                    <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
                      {p.role === 'agent' ? 'Interviewer' : 'You'} · turn {p.turn}
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{p.content}</div>
                  </div>
                ))
              )}
            </ScrollArea>

            {pendingQuestion && !advanced && (
              <div style={{ marginTop: 16 }} data-testid="interview-pending-question">
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                  Pillar {pendingQuestion.pillar}
                </div>
                {pendingQuestion.rationale && (
                  <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
                    {pendingQuestion.rationale}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    data-testid="interview-draft-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type your answer…"
                    disabled={answerStatus.kind === 'loading'}
                  />
                  <Button
                    onClick={submitAnswer}
                    data-testid="interview-submit"
                    disabled={answerStatus.kind === 'loading' || draft.trim().length === 0}
                    type="button"
                  >
                    {answerStatus.kind === 'loading' ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              </div>
            )}

            {answerStatus.kind === 'error' && (
              <div
                data-testid="interview-answer-error"
                style={{ color: '#b91c1c', fontSize: 13, marginTop: 12 }}
              >
                {answerStatus.message}
              </div>
            )}

            {(meetsThreshold || exhausted) && !advanced && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button
                  onClick={handleComplete}
                  disabled={completeStatus.kind === 'loading'}
                  data-testid="interview-complete"
                  type="button"
                >
                  {completeStatus.kind === 'loading' ? 'Completing…' : "I'm done — advance"}
                </Button>
                {showForceOverride && (
                  <label
                    data-testid="interview-force-label"
                    style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <input
                      type="checkbox"
                      data-testid="interview-force-checkbox"
                      checked={forceChecked}
                      onChange={(e) => setForceChecked(e.target.checked)}
                    />
                    Advance anyway (operator override)
                  </label>
                )}
                {completeStatus.kind === 'error' && (
                  <span
                    data-testid="interview-complete-error"
                    style={{ color: '#b91c1c', fontSize: 13 }}
                  >
                    {completeStatus.message}
                  </span>
                )}
              </div>
            )}

            {advanced && (
              <div
                data-testid="interview-advanced"
                style={{ marginTop: 16, color: '#065f46', fontSize: 13 }}
              >
                Interview complete — advancing to Information Architecture.
              </div>
            )}
          </div>

          <div style={{ width: 280, flexShrink: 0 }}>
            <PillarCoverage coverage={pillarCoverage} aggregate={aggregateScore} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
