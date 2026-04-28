'use client';
/**
 * BA agent-collab inspector (GATE-4-03).
 *
 * Renders a request/response thread of `agent_messages` rows from the
 * BA cross-agent collaboration protocol (PR #72 / PHASE1-02). For each
 * input-requested → input-received pair the inspector shows:
 *   - the requesting agent (always the BA agent in Phase 1) and the
 *     consultant it asked
 *   - the request payload (section name, deadline)
 *   - whether the consultant replied (and how long it took) or timed out
 *   - the reply payload, JSON-pretty-printed and collapsible
 *
 * Useful for debugging incomplete tickets — at a glance you can see
 * which consultant didn't reply or replied with malformed data, and
 * therefore why the ticket failed to validate.
 */
import { useMemo, useState } from 'react';

export interface AgentMessage {
  id: string;
  fromAgent: string;
  toAgent: string;
  messageType: string;
  correlationId: string;
  status: string;
  createdAt: number;
  processedAt: number | null;
  expectedReplyBy: number | null;
  repliedAt: number | null;
  parentMessageId: string | null;
  payload: unknown;
}

interface ThreadEntry {
  request: AgentMessage;
  reply: AgentMessage | null;
  timedOut: boolean;
  durationMs: number | null;
}

function fmtMs(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v < 1000) return `${v}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  return `${(v / 60_000).toFixed(1)}m`;
}

function buildThreads(messages: AgentMessage[]): ThreadEntry[] {
  const requests = messages.filter((m) => m.messageType === 'input-requested');
  const replyByParent = new Map<string, AgentMessage>();
  for (const m of messages) {
    if (m.messageType === 'input-received' && m.parentMessageId) {
      replyByParent.set(m.parentMessageId, m);
    }
  }
  return requests.map((req) => {
    const reply = replyByParent.get(req.id) ?? null;
    const timedOut = !reply && req.status === 'timed_out';
    const durationMs = reply ? reply.createdAt - req.createdAt : null;
    return { request: req, reply, timedOut, durationMs };
  });
}

function PayloadView({ payload }: { payload: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const truncated = text.length > 400;
  const display = expanded || !truncated ? text : `${text.slice(0, 400)}…`;
  return (
    <pre style={{
      margin: '6px 0 0',
      padding: 8,
      background: '#0f1117',
      border: '1px solid #2d3748',
      borderRadius: 4,
      color: '#cbd5e0',
      fontSize: 11,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }}>
      {display}
      {truncated && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          style={{
            display: 'block', marginTop: 6,
            background: 'none', border: 'none', color: '#63b3ed',
            cursor: 'pointer', fontSize: 11, padding: 0,
          }}
        >
          {expanded ? 'collapse' : 'show full'}
        </button>
      )}
    </pre>
  );
}

function StatusPill({ entry }: { entry: ThreadEntry }) {
  if (entry.reply) {
    return <span style={{ background: '#2f855a', color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>
      replied · {fmtMs(entry.durationMs)}
    </span>;
  }
  if (entry.timedOut) {
    return <span style={{ background: '#c53030', color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>
      timed out
    </span>;
  }
  return <span style={{ background: '#dd6b20', color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: 10 }}>
    pending
  </span>;
}

export function BACollabInspector({
  messages,
  emptyHint,
}: {
  messages: AgentMessage[];
  emptyHint?: string;
}) {
  const threads = useMemo(() => buildThreads(messages), [messages]);

  if (threads.length === 0) {
    return (
      <div data-testid="ba-collab-empty" style={{ color: '#718096', fontSize: 12, fontStyle: 'italic' }}>
        {emptyHint ?? 'No BA collaboration messages for this scope.'}
      </div>
    );
  }

  return (
    <div data-testid="ba-collab-inspector">
      <div style={{ color: '#a0aec0', fontSize: 12, marginBottom: 8 }}>
        {threads.length} request{threads.length === 1 ? '' : 's'}
        {' · '}
        {threads.filter((t) => t.reply).length} replied
        {threads.filter((t) => t.timedOut).length > 0 && (
          <> · <span style={{ color: '#fc8181' }}>{threads.filter((t) => t.timedOut).length} timed out</span></>
        )}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {threads.map((t) => (
          <li
            key={t.request.id}
            data-testid={`ba-collab-thread-${t.request.id}`}
            data-thread-status={t.reply ? 'replied' : (t.timedOut ? 'timed-out' : 'pending')}
            style={{
              background: '#1a1f2e',
              border: '1px solid #2d3748',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: '#90cdf4', fontWeight: 600, fontSize: 12 }}>
                {t.request.fromAgent}
              </span>
              <span style={{ color: '#a0aec0', fontSize: 11 }}>→</span>
              <span style={{ color: '#f6ad55', fontWeight: 600, fontSize: 12 }}>
                {t.request.toAgent}
              </span>
              <StatusPill entry={t} />
              <span style={{ marginLeft: 'auto', color: '#718096', fontSize: 10, fontFamily: 'monospace' }}>
                {new Date(t.request.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <div style={{ color: '#a0aec0', fontSize: 11, marginTop: 4 }}>
              corr <code>{t.request.correlationId}</code>
            </div>
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, color: '#a0aec0' }}>request</div>
              <PayloadView payload={t.request.payload} />
            </div>
            {t.reply && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: '#a0aec0' }}>reply ({t.reply.fromAgent})</div>
                <PayloadView payload={t.reply.payload} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
