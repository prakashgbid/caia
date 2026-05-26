/**
 * Multi-turn chat panel for the interview step.
 *
 * Pure-presentational: state, persistence, and engine calls live in the
 * page component. The panel renders the running turn log and offers a
 * single-line input + "Send" + "I'm done" controls. The transcript
 * scrolls inside a `ScrollArea` so the input stays pinned.
 */
'use client';

import * as React from 'react';
import { Card, CardContent, CardFooter, CardHeader, Button, Input, ScrollArea } from './ui';

export interface ChatTurn {
  readonly id: string;
  readonly role: 'agent' | 'user';
  readonly content: string;
  readonly turnNumber: number;
}

export interface ChatPanelProps {
  readonly turns: readonly ChatTurn[];
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onSend: (text: string) => void | Promise<void>;
  readonly onMarkDone: () => void | Promise<void>;
  readonly placeholder?: string;
}

export function ChatPanel({
  turns,
  disabled,
  busy,
  onSend,
  onMarkDone,
  placeholder = 'Type your response…',
}: ChatPanelProps) {
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns.length]);

  const send = React.useCallback(async () => {
    const text = draft.trim();
    if (!text || disabled || busy) return;
    setDraft('');
    await onSend(text);
  }, [draft, disabled, busy, onSend]);

  return (
    <Card data-testid="chat-panel" style={{ height: '100%' }}>
      <CardHeader>Interview</CardHeader>
      <CardContent>
        <ScrollArea
          data-testid="chat-transcript"
          // forward the underlying div ref via a wrapper because
          // ScrollArea is a plain styled div in our shadcn-stub.
          ref={scrollRef as unknown as React.Ref<HTMLDivElement>}
        >
          {turns.length === 0 ? (
            <div
              data-testid="chat-empty"
              style={{ color: '#94a3b8', fontStyle: 'italic', padding: 24 }}
            >
              The interviewer will greet you with the first question shortly…
            </div>
          ) : (
            turns.map((t) => (
              <div
                key={t.id}
                data-testid={`turn-${t.role}-${t.turnNumber}`}
                data-role={t.role}
                style={{
                  marginBottom: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: t.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    background: t.role === 'user' ? '#1e3a8a' : '#1f2937',
                    color: '#f0f4f8',
                    padding: '8px 12px',
                    borderRadius: 8,
                    maxWidth: '85%',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {t.content}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#64748b',
                    marginTop: 2,
                  }}
                >
                  {t.role === 'agent' ? 'Interviewer' : 'You'} · turn {t.turnNumber}
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </CardContent>
      <CardFooter>
        <Input
          aria-label="Your answer"
          data-testid="chat-input"
          value={draft}
          placeholder={placeholder}
          disabled={disabled || busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button
          data-testid="chat-send"
          onClick={() => void send()}
          disabled={disabled || busy || draft.trim().length === 0}
        >
          {busy ? 'Sending…' : 'Send'}
        </Button>
        <Button
          variant="secondary"
          data-testid="chat-done"
          disabled={disabled || busy}
          onClick={() => void onMarkDone()}
        >
          I&apos;m done
        </Button>
      </CardFooter>
    </Card>
  );
}
