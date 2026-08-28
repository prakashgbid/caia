'use client';

/**
 * <ProposalPanel> — Stage 5 build brief generator. Tailwind styled.
 * Auto-advances (via primary button) to /wizard/design after generation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Copy, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { LiveVoiceInput } from './common/LiveVoiceInput';
import { useSpec, advanceStage } from '../../lib/spec/store';
import { DocsUnlocked } from './common/DocsUnlocked';

interface Turn { role: 'user' | 'assistant'; content: string; }



export interface ProposalPanelProps { initialIdea?: string; }

export function ProposalPanel({ initialIdea }: ProposalPanelProps): React.JSX.Element {
  const router = useRouter();
  const [spec, mutateSpecFn] = useSpec();
  const [idea, setIdea] = useState<string>(initialIdea ?? spec.grandIdea ?? '');
  const [transcriptText, setTranscriptText] = useState<string>(JSON.stringify(spec.interview?.turns || [], null, 2));
  const [proposal, setProposal] = useState<string>('');
  const proposalOutputRef = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<{ model?: string; latencyMs?: number; costUsd?: number; turns?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { advanceStage('proposal'); }, []);
  useEffect(() => { if (proposal && proposalOutputRef.current) { proposalOutputRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, [proposal]);
  useEffect(() => {
    // Whenever the interview transcript updates (e.g. after synthesise), refresh the JSON field
    if (spec.interview?.turns && spec.interview.turns.length > 0) {
      const fresh = JSON.stringify(spec.interview.turns, null, 2);
      if (transcriptText !== fresh) setTranscriptText(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.interview?.turns]);
  useEffect(() => {
    if (!idea && spec.grandIdea) setIdea(spec.grandIdea);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.grandIdea]);
  useEffect(() => {
    if (!initialIdea && typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      const q = u.searchParams.get('idea');
      if (q && q.trim().length >= 10) setIdea(q.trim());

    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdea]);

  const generate = useCallback(async () => {
    if (busy || idea.trim().length < 10) return;
    setBusy(true);
    setError(null);
    setProposal('');
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
      const res = await fetch('/api/wizard/proposal/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grandIdea: idea, transcript: parsed }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Our AI provider is a bit slow right now. Please click Regenerate — most of the time the second try goes through cleanly.');
      }
      const body = (await res.json()) as { ok: boolean; proposal?: string; model?: string; latencyMs?: number; costUsd?: number; transcriptTurns?: number; error?: string; detail?: string; message?: string };
      if (!res.ok || !body.ok || !body.proposal) throw new Error(body.detail || body.message || body.error || `HTTP ${res.status}`);
      setProposal(body.proposal);
      setMeta({ model: body.model, latencyMs: body.latencyMs, costUsd: body.costUsd, turns: body.transcriptTurns });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, idea, transcriptText]);

  const copy = useCallback(async () => {
    if (!proposal) return;
    try {
      await navigator.clipboard.writeText(proposal);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  }, [proposal]);

  const goNext = useCallback(() => {
    router.push('/wizard/design?next=' + encodeURIComponent('/wizard/landing') + '&idea=' + encodeURIComponent(idea));
  }, [router, idea]);

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="w-3 h-3" />
          Step 5 · Proposal
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          Your <span className="text-brand-gradient">build brief</span>.
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          A one-page plainspoken plan: what CAIA will build, how it&apos;ll feel, what ships first, and
          what we&apos;ll need from you along the way.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Grand idea (from Step 2)</label>
              <LiveVoiceInput value={idea} onValueChange={setIdea} fieldLabel="grand idea" />
            </div>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              data-testid="proposal-idea"
              rows={3}
              className="w-full p-3 text-sm rounded-lg border border-border bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Interview transcript (JSON — optional)</label>
            <textarea
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              data-testid="proposal-transcript"
              rows={6}
              className="w-full p-3 text-xs font-mono rounded-lg border border-border bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              type="button"
              onClick={generate}
              disabled={busy || idea.trim().length < 10}
              data-testid="proposal-generate"
              className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold disabled:opacity-50"
            >
              {busy ? (<><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Drafting your brief…</>) : proposal ? 'Provide more details & regenerate (uses another AI call)' : (<>Generate proposal<ArrowRight className="w-4 h-4 ml-1.5" /></>)}
            </Button>
            {meta && (
              <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                {meta.model} · {meta.latencyMs}ms · ${meta.costUsd?.toFixed(5)}
              </span>
            )}
          </div>

          {error && (
            <div data-testid="proposal-error" className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2.5 text-sm">
              {error}
            </div>
          )}

          {proposal && (
            <div ref={proposalOutputRef} className="animate-fade-in-up space-y-4 pt-6 mt-6 border-t-2 border-primary/40 scroll-mt-20">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/15 text-primary border-primary/30">1-page build brief</Badge>
                <Button type="button" variant="outline" size="sm" onClick={copy} data-testid="proposal-copy">
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                  {copied ? 'Copied!' : 'Copy markdown'}
                </Button>
              </div>
              <div
                data-testid="proposal-output"
                className="prose prose-invert max-w-none p-6 rounded-xl bg-muted/30 border border-border/60 whitespace-pre-wrap leading-relaxed max-h-[720px] overflow-y-auto scrollbar-thin"
                style={{ fontFamily: 'ui-serif, Georgia, serif', fontSize: 15 }}
              >
                {proposal}
              </div>
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={goNext}
                  data-testid="proposal-continue"
                  className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
                >
                  Ready — head to Design
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
