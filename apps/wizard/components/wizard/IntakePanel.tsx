'use client';

/**
 * <IntakePanel> — Stage 3 template-driven intake. Tailwind styled.
 * Flow: brief → analyzing → gap-fill (with progress) → finalizing → summary.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, Lightbulb, PencilLine, RotateCcw, Sparkles } from 'lucide-react';
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
    text: "A directory app for small businesses on my street. Each shop gets a page they can update in 30 seconds — hours, today's specials, a photo. Neighbors browse by walking distance. First market is my Brooklyn neighborhood. Later we add reviews and simple ordering.",
  },
];

export function IntakePanel(): React.JSX.Element {
  const router = useRouter();
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

  const finalize = useCallback(async (a: AnalyzerResult, answers: Record<string, string | string[]>) => {
    setPhase('finalizing');
    try {
      const res = await fetch('/api/wizard/intake/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ideaText, filledSlots: a.filledSlots, gapAnswers: answers }),
      });
      const body = (await res.json()) as { ok: boolean; productName?: string; summaryCard?: string; model?: string; latencyMs?: number; costUsd?: number; error?: string; detail?: string };
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
        await finalize(result, {});
      } else {
        setPhase('gap-fill');
        // Fire parallel option-gen requests to populate MC options
        const enriched = await Promise.all(
          result.gaps.map(async (g) => {
            try {
              const r = await fetch('/api/wizard/intake/options', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ slotName: g.slotName, ideaText, productWorkingName: result.productWorkingName }),
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
  }, [ideaText, finalize]);

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
    const a = gapAnswers[currentGap.slotName];
    if ((typeof a === 'string' && a.trim().length === 0) || a === undefined) {
      setError('Pick an option or type your own answer before continuing.');
      return;
    }
    setError(null);
    if (gapIdx + 1 < analyzer.gaps.length) setGapIdx(gapIdx + 1);
    else await finalize(analyzer, gapAnswers);
  }, [analyzer, currentGap, gapAnswers, gapIdx, finalize]);

  const skipGap = useCallback(async () => {
    if (!analyzer || !currentGap) return;
    if (currentGap.required) {
      setError('This one is important — please pick an option or type your own answer.');
      return;
    }
    setError(null);
    setGapAnswers((prev) => ({ ...prev, [currentGap.slotName]: '' }));
    if (gapIdx + 1 < analyzer.gaps.length) setGapIdx(gapIdx + 1);
    else await finalize(analyzer, gapAnswers);
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
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="w-3 h-3" />
          Step 3 · Interview
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          Tell us about <span className="text-brand-gradient">your idea</span>.
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          Just describe what you want to build in your own words — a couple sentences is plenty.
          We&apos;ll fill in what we can, ask a few short follow-up questions for the rest, then show
          you what CAIA plans to build.
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
          <div className="py-12 text-center animate-fade-in-up">
            <Loader2 className="w-8 h-8 text-primary mx-auto animate-spin mb-4" />
            <p className="text-base font-medium text-foreground">Reading your idea…</p>
            <p className="mt-1 text-sm text-muted-foreground">
              About 15 seconds. We&apos;re figuring out what we already know and what to ask you.
            </p>
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
          <div className="py-12 text-center animate-fade-in-up">
            <Loader2 className="w-8 h-8 text-primary mx-auto animate-spin mb-4" />
            <p className="text-base font-medium text-foreground">Putting it all together…</p>
            <p className="mt-1 text-sm text-muted-foreground">
              About 15 seconds. Drafting a summary of what we heard for you to confirm.
            </p>
          </div>
        )}

        {phase === 'summary' && summary && (
          <div className="animate-fade-in-up space-y-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Here&apos;s what we heard. If it captures your idea, we&apos;re ready to keep going.</span>
            </div>
            <div
              data-testid="intake-summary"
              className="prose prose-invert max-w-none p-6 rounded-xl bg-muted/30 border border-border/60 whitespace-pre-wrap text-sm leading-relaxed"
              style={{ fontFamily: 'var(--font-sans)' }}
            >
              {summary.summaryCard}
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="button"
                onClick={() => router.push('/wizard/architecture?idea=' + encodeURIComponent(ideaText))}
                data-testid="intake-continue"
                className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
              >
                Looks good — keep going
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
              <Button type="button" variant="outline" onClick={startOver} data-testid="intake-restart" className="h-11">
                <RotateCcw className="w-4 h-4 mr-1.5" />
                Start over
              </Button>
              <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                {summary.model} · {summary.latencyMs}ms · ${summary.costUsd.toFixed(5)}
              </span>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 text-sm">
              {error ?? 'Something went wrong.'}
            </div>
            <Button type="button" onClick={startOver} data-testid="intake-restart-from-error">
              <RotateCcw className="w-4 h-4 mr-1.5" />
              Start over
            </Button>
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
    <div className="space-y-4 animate-fade-in-up">
      <div>
        <label htmlFor="intake-idea" className="block text-sm font-medium mb-2">
          In your own words — what do you want to build?
        </label>
        <textarea
          id="intake-idea"
          data-testid="intake-idea"
          value={props.ideaText}
          onChange={(e) => props.setIdeaText(e.target.value)}
          rows={8}
          placeholder={props.examples[0]!.text}
          className="w-full p-4 text-sm leading-relaxed rounded-lg border border-border bg-background/50 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-y"
        />
        <div className="mt-2 flex justify-between items-center text-xs">
          <span className="text-muted-foreground tabular-nums">{wordCount} words · aim for 30–100</span>
          <button
            type="button"
            onClick={() => props.setShowExamples(!props.showExamples)}
            data-testid="intake-toggle-examples"
            className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-medium transition-colors"
          >
            <Lightbulb className="w-3 h-3" />
            {props.showExamples ? 'Hide examples' : 'Show 3 examples from different domains'}
          </button>
        </div>
      </div>

      {props.showExamples && (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-4 animate-fade-in-up">
          {props.examples.map((ex, i) => (
            <div key={i} className={i === props.examples.length - 1 ? '' : 'pb-4 border-b border-border/40'}>
              <div className="flex justify-between items-center mb-1.5">
                <strong className="text-xs font-semibold text-foreground uppercase tracking-wider">{ex.label}</strong>
                <button
                  type="button"
                  onClick={() => props.setIdeaText(ex.text)}
                  data-testid={`intake-use-example-${i}`}
                  className="text-xs px-2.5 py-1 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors"
                >
                  Use this
                </button>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{ex.text}</p>
            </div>
          ))}
        </div>
      )}

      {props.error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2.5 text-sm">
          {props.error}
        </div>
      )}

      <div className="pt-2 flex items-center gap-3 flex-wrap">
        <Button
          type="button"
          onClick={props.onSubmit}
          disabled={props.ideaText.trim().length < 15}
          data-testid="intake-submit"
          className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
        >
          Analyze my idea
          <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
        <span className="text-xs text-muted-foreground">
          ~15 seconds. Then we&apos;ll show you the exact follow-ups (usually 3–5).
        </span>
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
  const progressPct = ((currentNum - 1) / totalGaps) * 100;
  const optionsLoading = options.length === 0;

  return (
    <div className="space-y-6 animate-fade-in-up" key={props.gap.slotName}>
      {/* Progress header */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Question {currentNum} of {totalGaps}</span>
            <Badge variant={props.gap.required ? 'destructive' : 'secondary'} className="text-[10px] uppercase tracking-wider">
              {props.gap.required ? 'required' : 'optional'}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            Working name: <strong className="text-foreground">{props.analyzer.productWorkingName}</strong>
          </span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-gradient transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <p className="text-lg text-foreground leading-relaxed">{props.gap.question}</p>

      {/* Options */}
      {optionsLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {options.map((opt, i) => {
            const isSelected = !props.customInputMode && selectedValue === opt;
            return (
              <button
                key={i}
                type="button"
                onClick={() => props.onSelectOption(opt)}
                data-testid={`intake-option-${i}`}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
                  isSelected
                    ? 'border-primary/60 bg-primary/10 text-foreground ring-1 ring-primary/40'
                    : 'border-border hover:border-primary/40 hover:bg-muted/40 text-foreground/90'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {isSelected ? <CheckCircle2 className="w-4 h-4" /> : String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-sm leading-relaxed">{opt}</span>
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={props.onEnableCustom}
            data-testid="intake-option-custom"
            className={`w-full text-left px-4 py-3 rounded-lg border-2 border-dashed transition-all ${
              props.customInputMode
                ? 'border-primary/50 bg-primary/5 text-foreground'
                : 'border-border/60 hover:border-primary/40 text-muted-foreground hover:text-foreground'
            }`}
          >
            <div className="flex items-center gap-3">
              <PencilLine className="w-4 h-4" />
              <span className="text-sm">Enter my own answer</span>
            </div>
          </button>
          {props.customInputMode && (
            <textarea
              data-testid="intake-custom-input"
              value={props.customText}
              onChange={(e) => props.onCustomText(e.target.value)}
              rows={3}
              placeholder="Type your answer here…"
              className="w-full mt-2 p-3 text-sm leading-relaxed rounded-lg border border-border bg-background/50 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              autoFocus
            />
          )}
        </div>
      )}

      {props.error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2.5 text-sm">
          {props.error}
        </div>
      )}

      <div className="pt-2 flex items-center gap-3 flex-wrap">
        <Button
          type="button"
          onClick={props.onNext}
          data-testid="intake-next"
          disabled={optionsLoading}
          className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
        >
          {currentNum === totalGaps ? 'Finish & show summary' : 'Next question'}
          <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
        {!props.gap.required && (
          <Button type="button" variant="outline" onClick={props.onSkip} data-testid="intake-skip" className="h-11">
            Skip this one
          </Button>
        )}
      </div>
    </div>
  );
}
