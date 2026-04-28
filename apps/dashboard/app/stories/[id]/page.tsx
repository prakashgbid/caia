'use client';
/**
 * Story detail page (GATE-4-03).
 *
 * Surfaces the self-contained ticket bundle (`GET /stories/:id/bundle`)
 * via `TicketBundleViewer` and the per-story BA agent-collab thread
 * (filtered out of the prompt's `/phase1` agentMessages payload by
 * sub-correlation `${promptCorrelationId}::${storyId}`) via
 * `BACollabInspector`. Live-refreshes when a Phase-1 event for this
 * story (or its parent prompt) arrives on the WS bus.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { TicketBundleViewer, type TicketBundle } from '../../../components/TicketBundleViewer';
import { BACollabInspector, type AgentMessage } from '../../../components/BACollabInspector';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:7776/events';

const PHASE1_TRIGGERS = [
  'pipeline.stage.advanced',
  'po-agent.', 'ba-agent.', 'task-scheduler.', 'ticket.', 'scaffolder.team.assembled',
  'prompt.ingested', 'prompt.status_changed', 'story.',
];

function isPhase1EventType(type: string | undefined): boolean {
  if (!type) return false;
  return PHASE1_TRIGGERS.some((p) => type === p || type.startsWith(p));
}

interface PromptPhase1Payload {
  prompt: { id: string; correlationId: string };
  agentMessages: AgentMessage[];
}

export default function StoryDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [bundle, setBundle] = useState<TicketBundle | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { lastEvent, connected } = useWebSocket(WS_URL);

  const refetch = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(`/api/stories/${id}/bundle`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`bundle HTTP ${res.status}`);
      const b = await res.json() as TicketBundle;
      setBundle(b);
      // Pull the prompt's phase1 payload to get the BA collab thread
      // for this story (sub-correlation matching).
      if (b.prompt?.id) {
        const r2 = await fetch(`/api/prompts/${b.prompt.id}/phase1`, { cache: 'no-store' });
        if (r2.ok) {
          const p = await r2.json() as PromptPhase1Payload;
          // Filter to messages whose correlationId targets this story.
          const subCorrSuffix = `::${id}`;
          const filtered = p.agentMessages.filter((m) =>
            m.correlationId === p.prompt.correlationId ||
            m.correlationId.endsWith(subCorrSuffix),
          );
          setMessages(filtered);
        }
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void refetch(); }, [refetch]);

  useEffect(() => {
    if (!lastEvent) return;
    if (!isPhase1EventType(lastEvent.type ?? lastEvent.kind)) return;
    // Only refetch if the event entity is this story or its prompt.
    const evCorr = (lastEvent as unknown as Record<string, unknown>)['correlationId']
      ?? (lastEvent.payload as Record<string, unknown> | undefined)?.['correlationId']
      ?? (lastEvent.payload as Record<string, unknown> | undefined)?.['correlation_id'];
    const promptCorr = bundle?.prompt?.correlationId;
    const evEntityId = (lastEvent.payload as Record<string, unknown> | undefined)?.['storyId']
      ?? (lastEvent.payload as Record<string, unknown> | undefined)?.['story_id']
      ?? (lastEvent.payload as Record<string, unknown> | undefined)?.['entityId'];
    const matches =
      evEntityId === id ||
      (typeof evCorr === 'string' && promptCorr && (evCorr === promptCorr || evCorr.startsWith(`${promptCorr}::`)));
    if (matches) void refetch();
  }, [lastEvent, bundle?.prompt?.correlationId, id, refetch]);

  if (loading) return <div style={{ color: '#718096', padding: 24 }}>Loading bundle…</div>;
  if (err) return <div style={{ color: '#fc8181', padding: 24 }}>Failed to load: {err}</div>;
  if (!bundle) return <div style={{ color: '#fc8181', padding: 24 }}>Story not found.</div>;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>
        <Link href="/stories" style={{ color: '#6b7280' }}>Stories</Link>
        {' → '}
        Story {id.slice(0, 14)}
        <span style={{ marginLeft: 12, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ reconnecting…'}
        </span>
      </div>

      <TicketBundleViewer bundle={bundle} />

      <div style={{ marginTop: 24 }}>
        <h3 style={{ margin: '0 0 8px', color: '#e2e8f0', fontSize: 16 }}>BA collaboration</h3>
        <BACollabInspector
          messages={messages}
          emptyHint="No BA agent_messages for this story yet — the BA agent has not started enriching this ticket."
        />
      </div>
    </div>
  );
}
