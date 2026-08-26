'use client';

/**
 * <IAPanel> — Stage 4 Information Architecture surface. Calls
 * POST /api/wizard/ia/demo, renders the markdown IA pack. Same shape
 * as ProposalPanel; the two are near-siblings that both consume a
 * grand idea + interview transcript.
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
  { role: 'assistant', content: 'How many paying businesses did you onboard in the last 30 days?' },
  { role: 'user', content: 'Zero — pre-launch. Plan: 25 via Brooklyn foot-canvas next 30 days.' },
  { role: 'assistant', content: 'How will businesses drive traffic to their StolBiz page?' },
  { role: 'user', content: 'QR sticker in storefront window with UTM. Target 30% see 100+ page views month one.' },
];

export interface IAPanelProps {
  initialIdea?: string;
}

export function IAPanel({ initialIdea }: IAPanelProps): React.JSX.Element {
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
    } catch {
      /* noop */
    }
  }, [ia]);

  return (
    <Card data-testid="ia-panel">
      <CardHeader>
        <CardTitle>Step 4 — Information Architecture</CardTitle>
        <CardDescription>
          Turn your grand idea + interview into an entity map, page inventory, and user flows a
          designer + engineer can build against. Feeds the Proposal (Step 5) and Design (Step 6) steps.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Grand idea (from Step 2)</label>
          <textarea value={idea} onChange={(e) => setIdea(e.target.value)} data-testid="ia-idea" rows={3} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Interview transcript (JSON array — optional)</label>
          <textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            data-testid="ia-transcript"
            rows={6}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
          />
          <small style={{ display: 'block', marginTop: 4, color: '#94a3b8', fontSize: 12 }}>
            Pre-filled with a Stolution sample for the demo. Replace with your Step 3 transcript.
          </small>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <Button type="button" onClick={generate} disabled={busy || idea.trim().length < 10} data-testid="ia-generate">
            {busy ? 'Mapping the product…' : ia ? 'Regenerate' : 'Generate IA pack →'}
          </Button>
          {meta && <span style={{ fontSize: 12, color: '#94a3b8' }}>{meta.model} · {meta.latencyMs}ms · ${meta.costUsd?.toFixed(4)} · {meta.turns} turns</span>}
        </div>
        {error && <div data-testid="ia-error" style={{ padding: 12, background: '#7f1d1d', color: '#fee2e2', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}
        {ia && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <Badge variant="default">IA pack</Badge>
              <Button type="button" variant="outline" onClick={copy} data-testid="ia-copy">{copied ? 'Copied!' : 'Copy markdown'}</Button>
            </div>
            <div
              data-testid="ia-output"
              style={{
                padding: 20,
                background: '#0f172a',
                borderRadius: 8,
                color: '#e2e8f0',
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, monospace',
                maxHeight: 720,
                overflowY: 'auto',
              }}
            >
              {ia}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
