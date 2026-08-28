'use client';

/**
 * <IdeaRefinerChat> — proper chat UI for the smart-question interview.
 *
 * Replaces the JSON-textarea "interview" with a real conversation:
 *   - Chat bubbles (assistant left, founder right)
 *   - Adaptive next-question via /api/wizard/interview/refine/next
 *   - Per-question "why we're asking" tooltip + answer-shape hint
 *   - Coverage bars showing which dimensions are now clear
 *   - Voice input on every founder answer (LiveVoiceInput)
 *   - Auto-persists to spec.interview.turns after every exchange
 *   - Synthesise button appears when model says readyToSynthesise, or after
 *     turnBudget reached, or manually via "I'm ready to move on"
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, HelpCircle, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@caia/ui';
import { LiveVoiceInput } from './common/LiveVoiceInput';
import { StageExplainer } from './common/StageExplainer';
import { ProcessLoader } from './common/ProcessLoader';
import { useSpec, advanceStage } from '../../lib/spec/store';
import type { InterviewTurn } from '../../lib/spec/schema';

type Dimension = 'who' | 'problem' | 'moment' | 'currentAlt' | 'wedge' | 'outcome' | 'proof' | 'advantage';
type Coverage = Record<Dimension, 0 | 1 | 2 | 3>;

interface NextQuestionResp {
  question: string;
  dimension: Dimension;
  whyAsking: string;
  answerHint?: string;
  readyToSynthesise: boolean;
  coverage: Coverage;
}

const DIM_LABEL: Record<Dimension, string> = {
  who: 'Who', problem: 'Problem', moment: 'When', currentAlt: 'Current alt',
  wedge: 'Wedge', outcome: 'Outcome', proof: 'Proof', advantage: 'Advantage',
};

const TURN_BUDGET = 8;

export function IdeaRefinerChat(): React.JSX.Element {
  const router = useRouter();
  const [spec, mutate] = useSpec();
  const [turns, setTurns] = useState<InterviewTurn[]>(spec.interview?.turns || []);
  const [input, setInput] = useState('');
  const [busyKind, setBusyKind] = useState<'question' | 'synthesise' | null>(null);
  const [nextQ, setNextQ] = useState<NextQuestionResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { advanceStage('interview'); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }); }, [turns.length, nextQ?.question]);

  // Fetch first question on mount when there are no turns yet
  useEffect(() => {
    if (turns.length === 0 && !nextQ && !busyKind && spec.grandIdea) {
      void fetchNext([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.grandIdea]);

  const fetchNext = useCallback(async (t: InterviewTurn[]) => {
    setBusyKind('question');
    setError(null);
    try {
      const res = await fetch('/api/wizard/interview/refine/next', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grandIdea: spec.grandIdea, turns: t.map((x) => ({ role: x.role, text: x.text })), turnBudget: TURN_BUDGET }),
      });
      if (!res.ok) throw new Error('CAIA had trouble thinking. Try again.');
      const j = (await res.json()) as { ok: boolean; error?: string } & NextQuestionResp;
      if (!j.ok) throw new Error(j.error || 'error');
      setNextQ(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKind(null);
    }
  }, [spec.grandIdea]);

  const submitAnswer = useCallback(async () => {
    if (!input.trim() || !nextQ) return;
    const assistantTurn: InterviewTurn = { role: 'assistant', text: nextQ.question, ts: Date.now() };
    const founderTurn: InterviewTurn = { role: 'user', text: input.trim(), ts: Date.now() };
    const nextTurns = [...turns, assistantTurn, founderTurn];
    setTurns(nextTurns);
    mutate((s) => { if (!s.interview) s.interview = { turns: [] }; s.interview.turns = nextTurns; });
    setInput('');
    setNextQ(null);
    await fetchNext(nextTurns);
  }, [input, nextQ, turns, mutate, fetchNext]);

  const synthesise = useCallback(async () => {
    setBusyKind('synthesise');
    setError(null);
    try {
      const res = await fetch('/api/wizard/interview/refine/synthesise', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grandIdea: spec.grandIdea, turns: turns.map((x) => ({ role: x.role, text: x.text })) }),
      });
      if (!res.ok) throw new Error('CAIA had trouble synthesising. Try again.');
      const j = (await res.json()) as { ok: boolean; error?: string; finiteIdea?: string; elevatorPitch?: string; who?: string; problem?: string; moment?: string; currentAlternative?: string; wedge?: string; outcome?: string; proof?: string[]; advantage?: string; coverage?: Coverage; openQuestions?: string[]; readinessScore?: number; readinessReasoning?: string };
      if (!j.ok) throw new Error(j.error || 'error');
      mutate((s) => {
        s.grandIdea = j.finiteIdea || s.grandIdea;
        if (!s.interview) s.interview = { turns: [] };
        s.interview.summary = [
          `**Finite idea:** ${j.finiteIdea}`,
          `**Who:** ${j.who}`,
          `**Problem:** ${j.problem}`,
          `**Wedge:** ${j.wedge}`,
          `**Outcome:** ${j.outcome}`,
          `**Current alternative:** ${j.currentAlternative}`,
          `**Advantage:** ${j.advantage}`,
          j.proof && j.proof.length ? `**Proof signals:** ${j.proof.join('; ')}` : '',
          j.openQuestions && j.openQuestions.length ? `**Open questions:** ${j.openQuestions.join('; ')}` : '',
          `**Readiness:** ${j.readinessScore}/100 — ${j.readinessReasoning}`,
        ].filter(Boolean).join('\n\n');
        s.interview.completedAt = Date.now();
      });
      router.push('/wizard/architecture');
    } catch (e) {
      setError((e as Error).message);
      setBusyKind(null);
    }
  }, [spec.grandIdea, turns, mutate, router]);

  const coverage = nextQ?.coverage;
  const coverageAvg = coverage
    ? Math.round(((Object.values(coverage) as number[]).reduce((s: number, v: number) => s + v, 0) / 8) * (100 / 3))
    : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <StageExplainer
        title="Sharpen your idea"
        body="Startups fail when the idea is fuzzy. CAIA asks a few smart questions to help you narrow from a broad vision to a finite, defensible starting point. Answer in your own words — we won't push you toward any particular answer."
        why="A sharper idea makes every downstream stage (market research, business plan, MVP scope) actually useful. Without this step, we'd be generating investor-grade documents for a moving target."
      />

      {/* Progress + coverage */}
      {(coverage || turns.length > 0) && (
        <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
          <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
            <span>Definability: <span className="font-semibold text-foreground tabular-nums">{coverageAvg}%</span></span>
            <span>{Math.floor(turns.length / 2)} / ~{TURN_BUDGET} questions answered</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-brand-gradient transition-all duration-500 rounded-full" style={{ width: `${coverageAvg}%` }} />
          </div>
          {coverage && (
            <div className="mt-3 grid grid-cols-4 sm:grid-cols-8 gap-1.5 text-[10px]">
              {(Object.keys(DIM_LABEL) as Dimension[]).map((d) => {
                const v = coverage[d];
                const colour = v === 3 ? 'bg-emerald-500' : v === 2 ? 'bg-primary' : v === 1 ? 'bg-amber-500' : 'bg-muted';
                return (
                  <div key={d} className="text-center">
                    <div className={`h-1 rounded-full ${colour}`} />
                    <div className={`mt-1 ${v === 0 ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>{DIM_LABEL[d]}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Chat transcript */}
      <div ref={scrollRef} className="rounded-2xl border border-border/60 bg-card/40 p-4 max-h-[420px] overflow-y-auto space-y-3">
        {turns.length === 0 && !nextQ && !busyKind && (
          <div className="text-center text-sm text-muted-foreground py-8">
            CAIA is preparing your first question…
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              t.role === 'assistant'
                ? 'bg-muted/60 text-foreground rounded-tl-sm'
                : 'bg-brand-gradient text-white rounded-tr-sm'
            }`}>
              {t.text}
            </div>
          </div>
        ))}
        {nextQ && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed bg-muted/60 text-foreground animate-in fade-in slide-in-from-bottom-1 duration-300">
              <div>{nextQ.question}</div>
              <button
                type="button"
                onClick={() => setShowWhy((v) => !v)}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
              >
                <HelpCircle className="w-3 h-3" />
                Why we're asking
              </button>
              {showWhy && (
                <div className="mt-2 rounded-lg bg-background/60 border border-border/50 px-3 py-2 text-xs text-muted-foreground">
                  {nextQ.whyAsking}
                  {nextQ.answerHint && <div className="mt-1 italic">Hint: {nextQ.answerHint}</div>}
                </div>
              )}
            </div>
          </div>
        )}
        {busyKind === 'question' && (
          <div className="flex justify-start">
            <div className="bg-muted/60 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              CAIA is thinking…
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 text-xs">{error}</div>
      )}

      {busyKind === 'synthesise' ? (
        <ProcessLoader
          status="Distilling your idea into a finite startup statement…"
          substeps={['Reading every answer…', 'Ranking coverage by dimension…', 'Writing your elevator pitch…', 'Scoring readiness for research…']}
        />
      ) : (
        <>
          {/* Answer input */}
          {nextQ && !nextQ.readyToSynthesise && (
            <div className="rounded-2xl border border-border/60 bg-card/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Your answer</span>
                <LiveVoiceInput value={input} onValueChange={setInput} fieldLabel="answer" />
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submitAnswer(); }}
                rows={3}
                placeholder="Type or speak your answer. Cmd/Ctrl+Enter to send."
                className="w-full p-3 text-sm rounded-lg border border-border bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
              <div className="flex gap-2">
                <Button onClick={submitAnswer} disabled={!input.trim() || busyKind !== null} className="flex-1 h-10 bg-brand-gradient hover:opacity-90 text-white text-sm font-semibold">
                  <ArrowRight className="w-4 h-4 mr-2" />
                  Send answer
                </Button>
                {turns.length >= 4 && (
                  <Button variant="outline" onClick={synthesise} className="h-10 text-sm">
                    I'm ready — sharpen it
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Synthesise gate — either model says ready, or we hit the turn budget */}
          {((nextQ?.readyToSynthesise) || turns.length / 2 >= TURN_BUDGET) && (
            <Button
              onClick={synthesise}
              className="w-full h-12 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Sharpen my idea into a finite startup statement
            </Button>
          )}
        </>
      )}
    </div>
  );
}
