'use client';

/**
 * <InterviewChat> — client-side chat surface for the /wizard/interview
 * step in demo mode. Talks to POST /api/wizard/interview/demo which is
 * OpenRouter-backed (free tier).
 *
 * Ephemeral state — history lives in useState, no persistence yet. The
 * grand idea is read from URL (?idea=...) or falls back to a demo idea
 * so the founder can test the flow without going through Stage 1 first.
 *
 * Reuse-first: uses @caia/ui primitives (Card, Button, Textarea, Badge).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  meta?: { model?: string; latencyMs?: number; turn?: number };
}

const DEMO_IDEA_FALLBACK =
  'A neighborhood-economy super-platform (Stolution) that connects small businesses, freelancers, and neighbors through StolBiz/StolShop/StolWork/StolServ marketplaces. Public directory pages funded by ads, no cart/checkout in MVP.';

export interface InterviewChatProps {
  initialIdea?: string;
}

export function InterviewChat({ initialIdea }: InterviewChatProps): React.JSX.Element {
  const [idea, setIdea] = useState<string>(initialIdea ?? '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<false | 'complete'>(false);
  // Sticky model — set from turn 1's response, passed back on every
  // subsequent turn so tone/style stays consistent through the conversation.
  const [stickyModel, setStickyModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Pull ?idea= from URL on mount if not passed as prop
  useEffect(() => {
    if (!initialIdea && typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      const q = u.searchParams.get('idea');
      if (q && q.trim().length >= 10) setIdea(q.trim());
      else if (!idea) setIdea(DEMO_IDEA_FALLBACK);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdea]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const kickOff = useCallback(async () => {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/wizard/interview/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grandIdea: idea, messages: [] }),
      });
      const body = (await res.json()) as {
        ok: boolean; reply?: string; model?: string; latencyMs?: number; turn?: number; done?: false | 'complete'; error?: string; detail?: string;
      };
      if (!res.ok || !body.ok || !body.reply) {
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      // Lock in the model that answered turn 1 so subsequent turns get the same voice.
      if (body.model) setStickyModel(body.model);
      setMessages([{ role: 'assistant', content: body.reply, meta: { model: body.model, latencyMs: body.latencyMs, turn: body.turn } }]);
      if (body.done === 'complete') setDone('complete');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [idea, busy, done]);

  const send = useCallback(async () => {
    if (busy || done) return;
    const trimmed = input.trim();
    if (trimmed.length < 2) return;
    const next: ChatMessage[] = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/wizard/interview/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grandIdea: idea,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          stickyModel: stickyModel ?? undefined,
        }),
      });
      const body = (await res.json()) as { ok: boolean; reply?: string; model?: string; latencyMs?: number; turn?: number; done?: false | 'complete'; error?: string; detail?: string };
      if (!res.ok || !body.ok || !body.reply) throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      // Refresh sticky only if it wasn't already set (safety); once set it stays put.
      if (!stickyModel && body.model) setStickyModel(body.model);
      setMessages([...next, { role: 'assistant', content: body.reply, meta: { model: body.model, latencyMs: body.latencyMs, turn: body.turn } }]);
      if (body.done === 'complete') setDone('complete');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [input, messages, idea, busy, done, stickyModel]);

  return (
    <Card data-testid="interview-chat">
      <CardHeader>
        <CardTitle>Step 3 — Interview</CardTitle>
        <CardDescription>
          The CAIA Interviewer will ask you questions across 12 dimensions until it has enough for a fundable plan.
          Answer in your own words — 1-3 sentences per turn is plenty. Runs on OpenRouter free-tier models in demo mode.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Your grand idea (from Step 2)</label>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            data-testid="interview-idea-input"
            rows={3}
            style={{ width: '100%' }}
            disabled={messages.length > 0}
          />
        </div>

        {messages.length === 0 && (
          <div style={{ marginBottom: 16 }}>
            <Button
              onClick={kickOff}
              disabled={busy || idea.trim().length < 10}
              data-testid="interview-start"
              type="button"
            >
              {busy ? 'Contacting interviewer…' : 'Start the interview →'}
            </Button>
            <p style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
              Free-tier models can take a few seconds. First response usually lands in 2-5s.
            </p>
          </div>
        )}

        {messages.length > 0 && (
          <div
            ref={scrollRef}
            data-testid="interview-transcript"
            style={{
              maxHeight: 480,
              overflowY: 'auto',
              padding: 12,
              background: '#0f172a',
              borderRadius: 8,
              marginBottom: 12,
            }}
          >
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Badge variant={m.role === 'user' ? 'default' : 'secondary'}>
                    {m.role === 'user' ? 'You' : 'CAIA Interviewer'}
                  </Badge>
                  {m.meta?.model && (
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {m.meta.model} · {m.meta.latencyMs}ms · turn {m.meta.turn}
                    </span>
                  )}
                </div>
                <div style={{ color: '#e2e8f0', fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {m.content.replace('[[READY-TO-SYNTHESIZE]]', '').trim()}
                </div>
              </div>
            ))}
            {busy && (
              <div style={{ color: '#94a3b8', fontSize: 13, fontStyle: 'italic' }}>
                Interviewer is thinking…
              </div>
            )}
          </div>
        )}

        {done === 'complete' && (
          <div
            data-testid="interview-complete"
            style={{ padding: 12, background: '#065f46', color: '#d1fae5', borderRadius: 6, marginBottom: 12 }}
          >
            ✓ The interviewer has enough coverage to synthesize a business plan. Click{' '}
            <strong>Information Architecture →</strong> above to continue the tour.
          </div>
        )}

        {error && (
          <div
            data-testid="interview-error"
            style={{ padding: 12, background: '#7f1d1d', color: '#fee2e2', borderRadius: 6, marginBottom: 12, fontSize: 13 }}
          >
            {error}
          </div>
        )}

        {messages.length > 0 && !done && (
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Your answer (Cmd/Ctrl + Enter to send)…"
              data-testid="interview-input"
              rows={3}
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={busy}
            />
            <Button
              onClick={send}
              disabled={busy || input.trim().length < 2}
              data-testid="interview-send"
              type="button"
            >
              {busy ? '…' : 'Send'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
