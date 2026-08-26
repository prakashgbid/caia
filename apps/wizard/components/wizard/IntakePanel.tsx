'use client';

/**
 * <IntakePanel> — the new template-driven idea intake surface.
 *
 * Replaces the chat-style Interview with a deterministic flow:
 *   Step A: big textarea (with example placeholder + "Show examples" toggle)
 *   Step B: analyzer runs → shows exactly N gap questions with MC + 5th "type my own"
 *   Step C: finalize → shows Stage-A summary card the founder confirms
 *
 * All state in memory only (session persistence deferred until after MVP).
 */

import { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

type Phase = 'brief' | 'analyzing' | 'gap-fill' | 'finalizing' | 'summary' | 'error';

interface GapSlot {
  slotName: string;
  label: string;
  question: string;
  kind: 'freeform' | 'enum' | 'freeform_list';
  required: boolean;
  options: string[];
  enumOptions?: string[];
}

interface AnalyzerResult {
  filledSlots: Record<string, { value: unknown; confidence: number }>;
  gaps: GapSlot[];
  gapCount: number;
  requiredGapCount: number;
  totalSlots: number;
  productWorkingName: string;
  industryDetected: string;
  model: string;
  costUsd: number;
  latencyMs: number;
}

const EXAMPLES = [
  {
    label: 'Neighborhood cooking',
    text: 'An app where neighbors share what they cook each day. You take a photo of your dinner and post it to a local feed. People nearby can react or ask for the recipe. Should feel warm and low-pressure — not another Instagram, more like a friendly bulletin board on your street.',
  },
  {
    label: 'Kids learn to code',
    text: 'A learn-to-code app for kids where they build tiny projects with a friend at the same time. Think Scratch but with a chat sidebar so two kids can code together across town. Must be safe for 8-12 year olds, no random strangers.',
  },
  {
    label: 'Small-shop directory',
    text: 'A directory app for small businesses on my street. Each shop gets a page they can update in 30 seconds — hours, today\'s specials, a photo. Neighbors browse by walking distance. First market is my Brooklyn neighborhood. Later we add reviews and simple ordering.',
  },
];

export function IntakePanel(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('brief');
  const [ideaText, setIdeaText] = useState('');
  const [showExamples, setShowExamples] = useState(false);
  const [analyzer, setAnalyzer] = useState<AnalyzerResult | null>(null);
  const [gapAnswers, setGapAnswers] = useState<Record<string, string | string[]>>({});
  const [gapIdx, setGapIdx] = useState(0);
  const [customInputMode, setCustomInputMode] = useState<Record<string, boolean>>({});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ productName: string; summaryCard: string; model: string; latencyMs: number; costUsd: number } | null>(null);

  const submitBrief = useCallback(async () => {
    if (ideaText.trim().length < 15) {
      setError('Please write at least a couple sentences about your idea (15+ characters).');
      return;
    }
    setError(null);
    setPhase('analyzing');
    try {
      const res = await fetch('/api/wizard/intake/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ideaText }),
      });
      const body = (await res.json()) as {
        ok: boolean; filledSlots?: AnalyzerResult['filledSlots']; gaps?: GapSlot[]; gapCount?: number;
        requiredGapCount?: number; totalSlots?: number; productWorkingName?: string; industryDetected?: string;
        model?: string; costUsd?: number; latencyMs?: number; error?: string; detail?: string; message?: string;
      };
      if (!res.ok || !body.ok || !body.gaps) throw new Error(body.detail || body.message || body.error || `HTTP ${res.status}`);
      const result: AnalyzerResult = {
        filledSlots: body.filledSlots ?? {},
        gaps: body.gaps,
        gapCount: body.gapCount ?? body.gaps.length,
        requiredGapCount: body.requiredGapCount ?? 0,
        totalSlots: body.totalSlots ?? 10,
        productWorkingName: body.productWorkingName ?? 'Your app',
        industryDetected: body.industryDetected ?? 'unknown',
        model: body.model ?? '',
        costUsd: body.costUsd ?? 0,
        latencyMs: body.latencyMs ?? 0,
      };
      setAnalyzer(result);
      setGapAnswers({});
      setGapIdx(0);
      if (result.gaps.length === 0) {
        // Nothing to ask — go straight to finalize
        await finalize(result, {});
      } else {
        // Fire parallel option-gen requests to populate each gap's MC options.
        // Analyzer returns fast with empty options[]; this fills them in
        // ~5-8s parallel. Enter phase gap-fill immediately so the first
        // question is visible while remaining options load in background.
        setPhase('gap-fill');
        const enriched = await Promise.all(
          result.gaps.map(async (g) => {
            try {
              const r = await fetch('/api/wizard/intake/options', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  slotName: g.slotName,
                  ideaText,
                  productWorkingName: result.productWorkingName,
                }),
              });
              const b = (await r.json()) as { ok: boolean; options?: string[] };
              return { ...g, options: b.ok && b.options ? b.options : g.options };
            } catch {
              return g;
            }
          }),
        );
        setAnalyzer((prev) => (prev ? { ...prev, gaps: enriched } : prev));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [ideaText]);

  const finalize = useCallback(async (a: AnalyzerResult, answers: Record<string, string | string[]>) => {
    setPhase('finalizing');
    try {
      const res = await fetch('/api/wizard/intake/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ideaText, filledSlots: a.filledSlots, gapAnswers: answers }),
      });
      const body = (await res.json()) as {
        ok: boolean; productName?: string; summaryCard?: string; model?: string; latencyMs?: number; costUsd?: number;
        error?: string; detail?: string;
      };
      if (!res.ok || !body.ok || !body.summaryCard) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      setSummary({
        productName: body.productName ?? 'Your app',
        summaryCard: body.summaryCard,
        model: body.model ?? '',
        latencyMs: body.latencyMs ?? 0,
        costUsd: body.costUsd ?? 0,
      });
      setPhase('summary');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [ideaText]);

  const currentGap = useMemo<GapSlot | null>(() => {
    if (!analyzer || gapIdx >= analyzer.gaps.length) return null;
    return analyzer.gaps[gapIdx] ?? null;
  }, [analyzer, gapIdx]);

  const selectOption = useCallback((slotName: string, opt: string) => {
    setGapAnswers((prev) => ({ ...prev, [slotName]: opt }));
    setCustomInputMode((prev) => ({ ...prev, [slotName]: false }));
  }, []);
  const enableCustom = useCallback((slotName: string) => {
    setCustomInputMode((prev) => ({ ...prev, [slotName]: true }));
    setGapAnswers((prev) => {
      const { [slotName]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);
  const setCustomText = useCallback((slotName: string, text: string) => {
    setCustomTexts((prev) => ({ ...prev, [slotName]: text }));
    setGapAnswers((prev) => ({ ...prev, [slotName]: text }));
  }, []);

  const nextGap = useCallback(async () => {
    if (!analyzer || !currentGap) return;
    // Ensure this slot has an answer
    const a = gapAnswers[currentGap.slotName];
    if ((typeof a === 'string' && a.trim().length === 0) || a === undefined) {
      setError('Pick an option or type your own answer before continuing.');
      return;
    }
    setError(null);
    if (gapIdx + 1 < analyzer.gaps.length) {
      setGapIdx(gapIdx + 1);
    } else {
      // All gaps answered — go finalize
      await finalize(analyzer, gapAnswers);
    }
  }, [analyzer, currentGap, gapAnswers, gapIdx, finalize]);

  const skipGap = useCallback(async () => {
    if (!analyzer || !currentGap) return;
    if (currentGap.required) {
      setError('This one is important — please pick an option or type your own answer.');
      return;
    }
    setError(null);
    // Record an explicit skip
    setGapAnswers((prev) => ({ ...prev, [currentGap.slotName]: '' }));
    if (gapIdx + 1 < analyzer.gaps.length) {
      setGapIdx(gapIdx + 1);
    } else {
      await finalize(analyzer, gapAnswers);
    }
  }, [analyzer, currentGap, gapIdx, gapAnswers, finalize]);

  const startOver = useCallback(() => {
    setPhase('brief');
    setAnalyzer(null);
    setSummary(null);
    setGapAnswers({});
    setGapIdx(0);
    setError(null);
  }, []);

  return (
    <Card data-testid="intake-panel">
      <CardHeader>
        <CardTitle>Tell us about your idea</CardTitle>
        <CardDescription>
          Just describe what you want to build in your own words — a couple sentences is plenty.
          We'll ask a few short follow-up questions to fill in what we need, then show you
          what CAIA plans to build for you. Should take 5-10 minutes total.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {phase === 'brief' && (
          <BriefPhase
            ideaText={ideaText}
            setIdeaText={setIdeaText}
            showExamples={showExamples}
            setShowExamples={setShowExamples}
            examples={EXAMPLES}
            onSubmit={submitBrief}
            error={error}
          />
        )}

        {phase === 'analyzing' && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
            <p style={{ fontSize: 15, marginBottom: 8 }}>Reading your idea…</p>
            <p style={{ fontSize: 13 }}>~15 seconds. We're figuring out what we already know and what we need to ask you.</p>
          </div>
        )}

        {phase === 'gap-fill' && analyzer && currentGap && (
          <GapPhase
            analyzer={analyzer}
            gap={currentGap}
            gapIdx={gapIdx}
            answer={gapAnswers[currentGap.slotName]}
            customInputMode={!!customInputMode[currentGap.slotName]}
            customText={customTexts[currentGap.slotName] ?? ''}
            onSelectOption={(opt) => selectOption(currentGap.slotName, opt)}
            onEnableCustom={() => enableCustom(currentGap.slotName)}
            onCustomText={(t) => setCustomText(currentGap.slotName, t)}
            onNext={nextGap}
            onSkip={skipGap}
            error={error}
          />
        )}

        {phase === 'finalizing' && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
            <p style={{ fontSize: 15, marginBottom: 8 }}>Putting it all together…</p>
            <p style={{ fontSize: 13 }}>~15 seconds. We're drafting a summary of what we heard for you to confirm.</p>
          </div>
        )}

        {phase === 'summary' && summary && (
          <div>
            <div style={{ marginBottom: 12, padding: 10, background: '#065f46', color: '#d1fae5', borderRadius: 6, fontSize: 13 }}>
              ✓ Here's what we heard. Give it a read — if it captures your idea, we're ready to keep going.
            </div>
            <div
              data-testid="intake-summary"
              style={{
                padding: 24,
                background: '#0f172a',
                borderRadius: 8,
                color: '#e2e8f0',
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                fontFamily: 'ui-serif, Georgia, serif',
                marginBottom: 16,
              }}
            >
              {summary.summaryCard}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/wizard/architecture?idea=' + encodeURIComponent(ideaText);
                  }
                }}
                data-testid="intake-continue"
              >
                Looks good — keep going →
              </Button>
              <Button type="button" variant="outline" onClick={startOver} data-testid="intake-restart">
                Start over
              </Button>
              <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>
                {summary.model} · {summary.latencyMs}ms · ${summary.costUsd.toFixed(5)}
              </span>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div>
            <div style={{ padding: 12, background: '#7f1d1d', color: '#fee2e2', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              {error ?? 'Something went wrong.'}
            </div>
            <Button type="button" onClick={startOver} data-testid="intake-restart-from-error">Start over</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BriefPhase(props: {
  ideaText: string;
  setIdeaText: (s: string) => void;
  showExamples: boolean;
  setShowExamples: (b: boolean) => void;
  examples: typeof EXAMPLES;
  onSubmit: () => void;
  error: string | null;
}): React.JSX.Element {
  const wordCount = props.ideaText.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div>
      <label htmlFor="intake-idea" style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
        In your own words — what do you want to build?
      </label>
      <textarea
        id="intake-idea"
        data-testid="intake-idea"
        value={props.ideaText}
        onChange={(e) => props.setIdeaText(e.target.value)}
        rows={8}
        placeholder={props.examples[0]!.text}
        style={{
          width: '100%',
          padding: 12,
          fontSize: 14,
          lineHeight: 1.5,
          border: '1px solid #334155',
          borderRadius: 6,
          background: '#0b1220',
          color: '#e2e8f0',
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{wordCount} words · aim for 30-100</span>
        <button
          type="button"
          onClick={() => props.setShowExamples(!props.showExamples)}
          data-testid="intake-toggle-examples"
          style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
        >
          {props.showExamples ? 'Hide examples' : 'Show 3 examples from different domains'}
        </button>
      </div>

      {props.showExamples && (
        <div style={{ marginTop: 12, padding: 12, background: '#0b1220', borderRadius: 6, border: '1px solid #1e293b' }}>
          {props.examples.map((ex, i) => (
            <div key={i} style={{ marginBottom: i === props.examples.length - 1 ? 0 : 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <strong style={{ color: '#cbd5e1', fontSize: 13 }}>{ex.label}</strong>
                <button
                  type="button"
                  onClick={() => props.setIdeaText(ex.text)}
                  data-testid={`intake-use-example-${i}`}
                  style={{ background: 'none', border: '1px solid #475569', color: '#94a3b8', fontSize: 11, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}
                >
                  Use this
                </button>
              </div>
              <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{ex.text}</p>
            </div>
          ))}
        </div>
      )}

      {props.error && (
        <div style={{ marginTop: 12, padding: 10, background: '#7f1d1d', color: '#fee2e2', borderRadius: 6, fontSize: 13 }}>
          {props.error}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Button type="button" onClick={props.onSubmit} disabled={props.ideaText.trim().length < 15} data-testid="intake-submit">
          Analyze my idea →
        </Button>
        <p style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
          Takes about 15 seconds. Then we'll show you exactly how many quick follow-up questions we need to answer before we can build.
        </p>
      </div>
    </div>
  );
}

function GapPhase(props: {
  analyzer: AnalyzerResult;
  gap: GapSlot;
  gapIdx: number;
  answer: string | string[] | undefined;
  customInputMode: boolean;
  customText: string;
  onSelectOption: (opt: string) => void;
  onEnableCustom: () => void;
  onCustomText: (t: string) => void;
  onNext: () => void;
  onSkip: () => void;
  error: string | null;
}): React.JSX.Element {
  const totalGaps = props.analyzer.gaps.length;
  const currentNum = props.gapIdx + 1;
  const selectedValue = typeof props.answer === 'string' ? props.answer : undefined;
  const options = props.gap.enumOptions ?? props.gap.options;

  return (
    <div>
      <div style={{ marginBottom: 16, padding: 10, background: '#0b1220', borderRadius: 6, fontSize: 13, color: '#cbd5e1' }}>
        <strong>Question {currentNum} of {totalGaps}</strong>
        {props.gap.required ? <span style={{ color: '#fca5a5', marginLeft: 8 }}>required</span> : <span style={{ color: '#94a3b8', marginLeft: 8 }}>optional</span>}
        {' · '}Working name: <strong>{props.analyzer.productWorkingName}</strong>
      </div>

      <p style={{ fontSize: 15, color: '#e2e8f0', marginBottom: 12, lineHeight: 1.5 }}>{props.gap.question}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt, i) => {
          const isSelected = !props.customInputMode && selectedValue === opt;
          return (
            <button
              key={i}
              type="button"
              onClick={() => props.onSelectOption(opt)}
              data-testid={`intake-option-${i}`}
              style={{
                textAlign: 'left',
                padding: '10px 14px',
                fontSize: 14,
                border: isSelected ? '2px solid #10b981' : '1px solid #334155',
                background: isSelected ? '#064e3b' : '#0b1220',
                color: '#e2e8f0',
                borderRadius: 6,
                cursor: 'pointer',
                lineHeight: 1.4,
              }}
            >
              {opt}
            </button>
          );
        })}
        <div>
          <button
            type="button"
            onClick={props.onEnableCustom}
            data-testid="intake-option-custom"
            style={{
              textAlign: 'left',
              padding: '10px 14px',
              fontSize: 14,
              border: props.customInputMode ? '2px solid #10b981' : '1px dashed #64748b',
              background: props.customInputMode ? '#064e3b' : 'transparent',
              color: '#94a3b8',
              borderRadius: 6,
              cursor: 'pointer',
              width: '100%',
              lineHeight: 1.4,
            }}
          >
            ✎ Enter my own answer
          </button>
          {props.customInputMode && (
            <textarea
              data-testid="intake-custom-input"
              value={props.customText}
              onChange={(e) => props.onCustomText(e.target.value)}
              rows={3}
              placeholder="Type your answer here…"
              style={{
                width: '100%',
                marginTop: 8,
                padding: 10,
                fontSize: 14,
                border: '1px solid #334155',
                borderRadius: 6,
                background: '#0b1220',
                color: '#e2e8f0',
                fontFamily: 'inherit',
              }}
            />
          )}
        </div>
      </div>

      {props.error && (
        <div style={{ marginTop: 12, padding: 10, background: '#7f1d1d', color: '#fee2e2', borderRadius: 6, fontSize: 13 }}>
          {props.error}
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
        <Button type="button" onClick={props.onNext} data-testid="intake-next">
          {currentNum === totalGaps ? 'Finish & show me the summary →' : 'Next question →'}
        </Button>
        {!props.gap.required && (
          <Button type="button" variant="outline" onClick={props.onSkip} data-testid="intake-skip">
            Skip this one
          </Button>
        )}
      </div>
    </div>
  );
}
