'use client';

/**
 * <GrandIdeaForm> — Stage 2 idea capture, Tailwind-styled to match the
 * rest of the wizard shell. Replaces the previous GrandIdeaStepBridge
 * shim over @caia/grand-idea/ui-component (that external component has
 * locked inline styles that don't match the brand).
 *
 * On successful capture: auto-advances to /wizard/interview per continuity.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Lightbulb, Sparkles } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, VoiceInput } from '@caia/ui';

const MIN_CHARS = 20;
const MIN_WORDS = 5;

export function GrandIdeaForm(): React.JSX.Element {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const canSubmit = trimmed.length >= MIN_CHARS && wordCount >= MIN_WORDS && !busy && !captured;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/grand-idea', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: trimmed, projectId: 'demo-project', tenantSlug: 'demo' }),
      });
      // Demo shim returns 200 with { ok:true, revisionNumber:1 } regardless.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCaptured(true);
      // Auto-advance after a brief celebratory pause (feels intentional, not jerky)
      setTimeout(() => {
        router.push('/wizard/interview?idea=' + encodeURIComponent(trimmed));
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [canSubmit, trimmed, router]);

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="w-3 h-3" />
          Step 2 · Grand Idea
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          What&apos;s the <span className="text-brand-gradient">one-line vision</span>?
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          The north-star description of what you want to build. A sentence or two is plenty — the
          Interviewer step will follow up with the specifics. Don&apos;t overthink it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <label htmlFor="gi-text" className="sr-only">Your idea</label>
            <textarea
              id="gi-text"
              data-testid="gi-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              disabled={captured}
              placeholder="e.g., A daily walking-buddy app for retired folks in my neighborhood — most of them are afraid to walk alone but would love company..."
              className="w-full p-4 text-base leading-relaxed rounded-lg border border-border bg-background/50 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all resize-y disabled:opacity-70"
            />
            <div className="mt-2 flex justify-between items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">{wordCount} words · {trimmed.length} chars</span>
              <span className="inline-flex items-center gap-1">
                <Lightbulb className="w-3 h-3" />
                Aim for ~{MIN_WORDS}+ words, one clear thought
              </span>
              <VoiceInput value={text} onValueChange={setText} fieldLabel="your idea" />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2.5 text-sm">
              {error}
            </div>
          )}

          {captured && (
            <div
              data-testid="gi-captured"
              className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-4 py-3 text-sm flex items-center gap-2 animate-fade-in-up"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Got it! Handing off to the CAIA Interviewer…</span>
            </div>
          )}

          <div className="pt-2 flex items-center gap-3">
            <Button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              data-testid="gi-submit"
              className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
            >
              {captured ? 'Continuing…' : busy ? 'Capturing…' : (
                <>
                  Capture &amp; continue
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </>
              )}
            </Button>
            {!captured && (
              <span className="text-xs text-muted-foreground">Next up: a few follow-ups so we can build for you.</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
