'use client';

/**
 * <ProposalPanel> — client-side surface for the /wizard/proposal step.
 * Lets the founder generate a 1-page investor memo from a grand idea +
 * (optionally) an interview transcript. Talks to POST /api/wizard/proposal/demo.
 *
 * Pre-fills the grand idea from ?idea= (or a fallback) and offers a
 * textarea to paste-in an interview transcript in the simple JSON shape
 * from the interview step (matches Array<{role, content}>).
 *
 * On generate: shows the returned markdown proposal + metadata (model,
 * cost, latency), plus a Copy button and a Regenerate button.
 */

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const DEMO_IDEA_FALLBACK =
  'A neighborhood-economy super-platform (Stolution) that connects small businesses, freelancers, and neighbors through StolBiz/StolShop/StolWork/StolServ marketplaces. Public directory pages funded by ads, no cart/checkout in MVP.';

const DEMO_TRANSCRIPT_FALLBACK: Turn[] = [
  { role: 'assistant', content: 'How many paying businesses or active freelancers did you personally onboard in the last 30 days, and how did you find them?' },
  { role: 'user', content: 'Zero so far — the platform is pre-launch. Plan is to start with StolBiz (small business directory) and onboard 25 businesses manually via foot-canvas in my Brooklyn neighborhood in the next 30 days.' },
  { role: 'assistant', content: "How will those 25 businesses actually find and visit their public StolBiz page — is it organic Google traffic, flyers, a QR code in a storefront window, or something else — and how will you know which channel worked?" },
  { role: 'user', content: 'Each business gets a printed QR sticker for their storefront window that links to their StolBiz page. Attribution via UTM params. Target 30% of the 25 to see 100+ page views in the first month.' },
];

export interface ProposalPanelProps {
  initialIdea?: string;
}

export function ProposalPanel({ initialIdea }: ProposalPanelProps): React.JSX.Element {
  const [idea, setIdea] = useState<string>(initialIdea ?? '');
  const [transcriptText, setTranscriptText] = useState<string>(JSON.stringify(DEMO_TRANSCRIPT_FALLBACK, null, 2));
  const [proposal, setProposal] = useState<string>('');
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
    setProposal('');
    setMeta(null);
    let parsedTranscript: Turn[] = [];
    if (transcriptText.trim().length > 0) {
      try {
        const parsed = JSON.parse(transcriptText);
        if (!Array.isArray(parsed)) throw new Error('transcript must be a JSON array');
        parsedTranscript = parsed as Turn[];
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
        body: JSON.stringify({ grandIdea: idea, transcript: parsedTranscript }),
      });
      const body = (await res.json()) as {
        ok: boolean; proposal?: string; model?: string; latencyMs?: number; costUsd?: number;
        transcriptTurns?: number; error?: string; detail?: string; message?: string;
      };
      if (!res.ok || !body.ok || !body.proposal) throw new Error(body.detail || body.message || body.error || `HTTP ${res.status}`);
      setProposal(body.proposal);
      setMeta({
        model: body.model,
        latencyMs: body.latencyMs,
        costUsd: body.costUsd,
        turns: body.transcriptTurns,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy, idea, transcriptText]);

  const copyToClipboard = useCallback(async () => {
    if (!proposal) return;
    try {
      await navigator.clipboard.writeText(proposal);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  }, [proposal]);

  return (
    <Card data-testid="proposal-panel">
      <CardHeader>
        <CardTitle>Step 5 — Proposal</CardTitle>
        <CardDescription>
          Generate a 1-page investor memo from your grand idea plus (optionally) your interview transcript.
          Runs on OpenRouter free-tier models — no cost to you, ~5-10s to synthesize.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Grand idea (from Step 2)</label>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            data-testid="proposal-idea"
            rows={3}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Interview transcript (JSON array — optional but recommended)
          </label>
          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            data-testid="proposal-transcript"
            rows={6}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            placeholder='[{"role":"assistant","content":"..."},{"role":"user","content":"..."}]'
          />
          <small style={{ display: 'block', marginTop: 4, color: '#94a3b8', fontSize: 12 }}>
            Pre-filled with a sample Stolution transcript for the demo. Replace with your own from Step 3.
          </small>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <Button
            type="button"
            onClick={generate}
            disabled={busy || idea.trim().length < 10}
            data-testid="proposal-generate"
          >
            {busy ? 'Drafting your memo…' : proposal ? 'Regenerate' : 'Generate proposal →'}
          </Button>
          {meta && (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>
              {meta.model} · {meta.latencyMs}ms · ${meta.costUsd?.toFixed(4)} · {meta.turns} transcript turns
            </span>
          )}
        </div>

        {error && (
          <div
            data-testid="proposal-error"
            style={{ padding: 12, background: '#7f1d1d', color: '#fee2e2', borderRadius: 6, marginBottom: 12, fontSize: 13 }}
          >
            {error}
          </div>
        )}

        {proposal && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <Badge variant="default">1-page memo</Badge>
              <Button type="button" variant="outline" onClick={copyToClipboard} data-testid="proposal-copy">
                {copied ? 'Copied!' : 'Copy markdown'}
              </Button>
            </div>
            <div
              data-testid="proposal-output"
              style={{
                padding: 20,
                background: '#0f172a',
                borderRadius: 8,
                color: '#e2e8f0',
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                fontFamily: 'ui-serif, Georgia, serif',
                maxHeight: 720,
                overflowY: 'auto',
              }}
            >
              {proposal}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
