'use client';

/**
 * ChatPanel — operator chat surface backed by `@ai-sdk/react`'s `useChat`
 * hook + the `/api/chat` streaming endpoint.
 *
 * Wave 1.3 of the Enterprise Wave 1 campaign per
 * `agent/memory/enterprise_ai_landscape_directive.md` (W1-2-add).
 */

import { useChat } from '@ai-sdk/react';
import { type FormEvent, useEffect, useRef } from 'react';

const SUBAGENT_HINT = [
  'Try one of these to see routing:',
  '  • "Decompose into stories: build a new dashboard"  →  caia-po (decomposition)',
  '  • "Enrich this story with acceptance criteria"      →  caia-ba (enrichment)',
  '  • "Run the DoD checklist on PR 342"                 →  caia-validator (dod-check)',
  '  • "Open the PR with auto-merge"                     →  caia-coding (pr-flow)',
  '  • "CI failed — diagnose"                            →  caia-fix-it (failure-diagnosis)',
  '  • "Scan findings + emit alarms"                     →  caia-curator (action-routing)'
].join('\n');

export function ChatPanel(): JSX.Element {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error, status } = useChat({
    api: '/api/chat',
    initialMessages: [
      {
        id: 'system-welcome',
        role: 'assistant',
        content:
          'Hi — I route operator prompts to the canonical CAIA subagents (caia-po, caia-ba, caia-ea, caia-validator, caia-test-design, caia-coding, caia-fix-it, caia-steward, caia-mentor, caia-curator).\n\n' +
          SUBAGENT_HINT +
          '\n\nWhen `CAIA_ORCHESTRATOR_URL` is set, prompts are also forwarded to the live orchestrator.'
      }
    ]
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    handleSubmit(e);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 96px)',
        maxHeight: 'calc(100vh - 96px)',
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 6
      }}
      aria-label="CAIA chat panel"
    >
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
        aria-live="polite"
        data-testid="chat-message-list"
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? '#2d3748' : '#1f2937',
              border: '1px solid #2d3748',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: m.role === 'user' ? '#f0f4f8' : '#cbd5e0'
            }}
            data-testid={`chat-message-${m.role}`}
          >
            <div
              style={{
                fontSize: 11,
                color: m.role === 'user' ? '#90cdf4' : '#68d391',
                marginBottom: 4,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              {m.role}
            </div>
            {m.content}
          </div>
        ))}
        {isLoading && (
          <div style={{ fontSize: 12, color: '#a0aec0', padding: '4px 8px' }} data-testid="chat-streaming">
            Streaming response…
          </div>
        )}
        {error && (
          <div
            style={{
              background: '#742a2a',
              color: '#fed7d7',
              border: '1px solid #c53030',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12
            }}
            role="alert"
            data-testid="chat-error"
          >
            Chat error: {error.message}
          </div>
        )}
      </div>

      <form
        onSubmit={onSubmit}
        style={{
          display: 'flex',
          gap: 8,
          padding: 12,
          borderTop: '1px solid #2d3748',
          background: '#1f2937'
        }}
        aria-label="Chat input form"
      >
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder="Ask the CAIA platform anything…"
          aria-label="Chat input"
          data-testid="chat-input"
          disabled={isLoading}
          style={{
            flex: 1,
            background: '#0f1117',
            border: '1px solid #2d3748',
            borderRadius: 4,
            padding: '8px 12px',
            color: '#f0f4f8',
            fontSize: 13,
            outline: 'none'
          }}
        />
        <button
          type="submit"
          disabled={isLoading || input.trim().length === 0}
          data-testid="chat-send"
          style={{
            background: isLoading || input.trim().length === 0 ? '#2d3748' : '#3182ce',
            color: '#f0f4f8',
            border: 'none',
            borderRadius: 4,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: isLoading || input.trim().length === 0 ? 'not-allowed' : 'pointer'
          }}
        >
          {status === 'submitted' || status === 'streaming' ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

export default ChatPanel;
