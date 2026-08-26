'use client';

/**
 * <IAPanel> — Stage 4 Information Architecture generator. Tailwind styled.
 * Auto-advances to /wizard/proposal after successful generation (user
 * clicks the primary button which routes forward).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Copy, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

interface Turn { role: 'user' | 'assistant'; content: string; }

const DEMO_IDEA_FALLBACK =
  'A neighborhood-economy super-platform (Stolution) that connects small businesses, freelancers, and neighbors through StolBiz/StolShop/StolWork/StolServ marketplaces. Public directory pages funded by ads, no cart/checkout in MVP.';

const DEMO_TRANSCRIPT_FALLBACK: Turn[] = [
  { role: 'assistant', content: 'How many paying businesses did you onboard in the last 30 days?' },
  { role: 'user', content: 'Zero — pre-launch. Plan: 25 via Brooklyn foot-canvas next 30 days.' },
  { role: 'assistant', content: 'How will businesses drive traffic to their StolBiz page?' },
  { role: 'user', content: 'QR sticker in storefront window with UTM. Target 30% see 100+ page views month one.' },
];

export interface IAPanelProps { initialIdea?: string; }

export function IAPanel({ initialIdea }: IAPanelProps): React.JSX.Element {
  const router = useRouter();
  const [idea, setIdea] = useState<string>(initialIdea ?? '');
  const [transcriptText, setTranscriptText] = useState<string>(JSON.stringify(DEMO_TRANSCRIPT_FALLBACK, null, 2));
  const [ia, setIa] = useState<string>('');
  const [meta, setMeta] = useState<{ model?: string; latencyMs?: number; costUsd?: number; turns?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!initialIdea && typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      const q = u.searchParams.get('idea');
      if (q && q.trim().length >= 10) setIdea(q.trim());
      else if (!idea) setIdea(DEMO_IDEA_FALLBACK);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdea]);

  const generate = useCallback(async () => {
    if (busy || idea.trim().length < 10) return;
    setBusy(true);
    setError(null);
    setIa('');
    setMeta(null);
    let parsed: Turn[] = [];
    if (transcriptText.trim().length > 0) {
      try {
        const p = JSON.parse(transcriptText);
        if (!Array.isArray(p)) throw new Error('transcript must be a JSON array');
        parsed = p as Turn[];
      } catch (e) {
        setError(`Transcript JSON is invalid: ${e instanceof Error ? e.message : String(e)}`);
        setBusy(false);
        return;
      }
    }
    try {
      const res = await fetch('/api/wizard/ia/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grandIdea: idea, transcript: parsed }),
      });
      const body = (await res.json()) as { ok: boolean; ia?: string; model?: string; latencyMs?: number; costUsd?: number; transcriptTurns?: number; error?: string; detail?: string; message?: string };
      if (!res.ok || !body.ok || !body.ia) throw new Error(body.detail || body.message || body.error || `HTTP ${res.status}`);
      setIa(body.ia);
      setMeta({ model: body.model, latencyMs: body.latencyMs, costUsd: body.costUsd, turns: body.transcriptTurns });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, idea, transcriptText]);

  const copy = useCallback(async () => {
    if (!ia) return;
    try {
      await navigator.clipboard.writeText(ia);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  }, [ia]);

  const goNext = useCallback(() => {
    router.push('/wizard/proposal?idea=' + encodeURIComponent(idea));
  }, [router, idea]);

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="w-3 h-3" />
          Step 4 · Information Architecture
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          The <span className="text-brand-gradient">map</span> of your app.
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          Entities, pages, user flows, and MVP cuts — drawn from your idea + interview. Feeds the Proposal (Step 5) and Design (Step 6).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Grand idea (from Step 2)</label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              data-testid="ia-idea"
              rows={3}
              className="w-full p-3 text-sm rounded-lg border border-border bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Interview transcript (JSON — optional)</label>
            <textarea
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              data-testid="ia-transcript"
              rows={6}
              className="w-full p-3 text-xs font-mono rounded-lg border border-border bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Pre-filled with a Stolution sample. Replace with your Step 3 transcript for a personalized IA.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              type="button"
              onClick={generate}
              disabled={busy || idea.trim().length < 10}
              data-testid="ia-generate"
              className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold disabled:opacity-50"
            >
              {busy ? (<><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Mapping the product…</>) : ia ? 'Regenerate' : (<>Generate IA pack<ArrowRight className="w-4 h-4 ml-1.5" /></>)}
            </Button>
            {meta && (
              <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                {meta.model} · {meta.latencyMs}ms · ${meta.costUsd?.toFixed(5)}
              </span>
            )}
          </div>

          {error && (
            <div data-testid="ia-error" className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2.5 text-sm">
              {error}
            </div>
          )}

          {ia && (
            <div className="animate-fade-in-up space-y-4 pt-2">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/15 text-primary border-primary/30">IA pack</Badge>
                <Button type="button" variant="outline" size="sm" onClick={copy} data-testid="ia-copy">
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                  {copied ? 'Copied!' : 'Copy markdown'}
                </Button>
              </div>
              <div
                data-testid="ia-output"
                className="prose prose-invert max-w-none p-6 rounded-xl bg-muted/30 border border-border/60 whitespace-pre-wrap text-sm leading-relaxed font-mono text-xs sm:text-sm max-h-[720px] overflow-y-auto scrollbar-thin"
              >
                {ia}
              </div>
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={goNext}
                  data-testid="ia-continue"
                  className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
                >
                  Looks good — draft the Proposal
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
