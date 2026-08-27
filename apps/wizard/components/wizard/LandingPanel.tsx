'use client';

/**
 * <LandingPanel> — Stage 6 Landing Page Preview.
 * Generates a self-contained HTML landing page, previews it in an iframe,
 * then routes to /wizard/login on continue.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Copy, CheckCircle2, ExternalLink, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { spendTokens, readSession } from '../../lib/session/tokens';
import { addDoc, updateProject } from '../../lib/session/project';
import { StageExplainer } from './common/StageExplainer';
import { InputExplainer } from './common/InputExplainer';
import { VoiceInput } from './common/VoiceInput';
import { ProcessLoader } from './common/ProcessLoader';
import { AiFailurePanel } from './common/AiFailurePanel';
import { validateFreeText } from '../../lib/validate/text';


export interface LandingPanelProps { initialIdea?: string; initialProposal?: string; }

async function fireExecSummary(ctx: { idea: string; proposal: string }): Promise<void> {
  try {
    const res = await fetch('/api/wizard/docs/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docSlug: 'executive-summary', projectContext: ctx }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { ok?: boolean; content?: string; title?: string; format?: string };
    if (!json.ok || !json.content) return;
    addDoc({
      id: 'doc_execsum_' + Math.random().toString(36).slice(2, 9),
      type: 'executive-summary',
      title: json.title || 'Executive Summary',
      format: (json.format as 'markdown' | 'html' | 'pdf' | 'pptx') || 'markdown',
      content: json.content,
      createdAt: Date.now(),
      tokens: 0,
    });
  } catch { /* silent — background fire */ }
}

export function LandingPanel({ initialIdea, initialProposal }: LandingPanelProps): React.JSX.Element {
  const router = useRouter();
  const [idea, setIdea] = useState(initialIdea ?? '');
  const [proposal, setProposal] = useState(initialProposal ?? '');
  const [html, setHtml] = useState('');
  const [meta, setMeta] = useState<{ model?: string; latencyMs?: number; costUsd?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!initialIdea && typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      const q = u.searchParams.get('idea');
      if (q) setIdea(decodeURIComponent(q));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = useCallback(async () => {
    if (busy) return;
    const v = validateFreeText(idea, { minLen: 15, requireSentence: true });
    if (!v.ok) { setError(v.reason || 'Please rewrite your idea.'); return; }
    setBusy(true);
    setError(null);
    setHtml('');
      // Persist the landing HTML into the project store as a doc.
      const _landingHtml = '';
      addDoc({
        id: 'landing_' + Math.random().toString(36).slice(2, 9),
        type: 'landing-html',
        title: 'Landing Page',
        format: 'html',
        content: _landingHtml,
        createdAt: Date.now(),
        tokens: 0,
      });
      updateProject((p) => { p.landingHtml = _landingHtml; p.idea = idea; p.proposal = proposal; });
      // Background: fire executive-summary generation once so the folder icon lights up.
      void fireExecSummary({ idea, proposal });

    try {
      const res = await fetch('/api/wizard/landing/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ideaText: idea, proposal }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error("Server slow right now — click Generate again.");
      const body = (await res.json()) as { ok: boolean; html?: string; model?: string; latencyMs?: number; costUsd?: number; error?: string; detail?: string; message?: string };
      if (!res.ok || !body.ok || !body.html) throw new Error(body.detail || body.message || body.error || `HTTP ${res.status}`);
      setHtml(body.html);
      setMeta({ model: body.model, latencyMs: body.latencyMs, costUsd: body.costUsd });
      spendTokens('landing');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, idea, proposal]);

  const copy = useCallback(async () => {
    if (!html) return;
    try { await navigator.clipboard.writeText(html); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* noop */ }
  }, [html]);

  const openInNewTab = useCallback(() => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }, [html]);

  const goNext = useCallback(() => {
    const s = readSession();
    if (s.tokens <= 0 && !s.loggedIn) {
      router.push('/wizard/login?next=' + encodeURIComponent('/wizard/build'));
    } else {
      router.push('/wizard/build');
    }
  }, [router]);

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="w-3 h-3" />
          Step 6 · Landing Page
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          Your app&apos;s <span className="text-brand-gradient">first look</span>.
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          A full landing page for your idea — header, hero, features, social proof, FAQ, footer. This is the first
          real visual of what CAIA is building. Iterate until it feels right, then keep going.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {!html && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-2">Grand idea</label>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={3}
                  className="w-full p-3 text-sm rounded-lg border border-border bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Proposal / build brief <span className="font-normal text-muted-foreground">(optional — improves quality)</span></label>
                <textarea
                  value={proposal}
                  onChange={(e) => setProposal(e.target.value)}
                  rows={4}
                  placeholder="Paste the markdown from Step 5 to give the landing page real substance…"
                  className="w-full p-3 text-xs font-mono rounded-lg border border-border bg-background/50 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                />
              </div>
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={generate}
                  disabled={busy || idea.trim().length < 10}
                  className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold disabled:opacity-50"
                >
                  {busy ? (<><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Designing your landing…</>) : (<>Generate landing page<ArrowRight className="w-4 h-4 ml-1.5" /></>)}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">~15-25 seconds. This one takes a bit — we&apos;re writing real HTML with a full layout.</p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2.5 text-sm">{error}</div>
          )}

          {html && (
            <div className="animate-fade-in-up space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">Live preview</Badge>
                <Button type="button" variant="outline" size="sm" onClick={openInNewTab}>
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open in new tab
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={copy}>
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                  {copied ? 'Copied!' : 'Copy HTML'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={generate} disabled={busy}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Regenerate
                </Button>
                {meta && (
                  <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                    {meta.model} · {meta.latencyMs}ms · ${meta.costUsd?.toFixed(5)}
                  </span>
                )}
              </div>
              <div className="rounded-xl overflow-hidden border border-border/60 shadow-2xl shadow-primary/10">
                <iframe
                  title="Landing page preview"
                  srcDoc={html}
                  className="w-full h-[720px] bg-white"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
              <div className="pt-2">
                <Button
                  type="button"
                  onClick={goNext}
                  className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
                >
                  Looks great — build the MVP
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
