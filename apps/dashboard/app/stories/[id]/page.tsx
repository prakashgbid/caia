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
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { TicketBundleViewer, type TicketBundle } from '../../../components/TicketBundleViewer';
import { BACollabInspector, type AgentMessage } from '../../../components/BACollabInspector';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:7776/events';

const PHASE1_TRIGGERS = [
  'pipeline.stage.advanced',
  'po-agent.', 'ba-agent.', 'task-scheduler.', 'ticket.', 'scaffolder.team.assembled',
  'prompt.ingested', 'prompt.status_changed', 'story.',
  // TEST-006 — story-driven testing framework lifecycle
  'test.',
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
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
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

  const startEdit = useCallback(() => {
    if (!bundle) return;
    setEditTitle(bundle.story.title);
    setEditDescription(bundle.story.description);
    setSaveErr(null);
    setEditing(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [bundle]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setSaveErr(null);
  }, []);

  const saveEdit = useCallback(async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await fetch(`/api/stories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim(), description: editDescription.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((body['error'] as string | undefined) ?? `HTTP ${res.status}`);
      }
      setEditing(false);
      await refetch();
    } catch (e) {
      setSaveErr(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [id, editTitle, editDescription, refetch]);

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ color: '#6b7280', fontSize: 12 }}>
          <Link href="/stories" style={{ color: '#6b7280' }}>Stories</Link>
          {' → '}
          Story {id.slice(0, 14)}
          <span style={{ marginLeft: 12, color: connected ? '#68d391' : '#fc8181' }}>
            {connected ? '● live' : '○ reconnecting…'}
          </span>
        </div>
        {!editing && (
          <button
            data-testid="story-edit-btn"
            onClick={startEdit}
            style={{
              background: '#2d3748',
              border: '1px solid #4a5568',
              borderRadius: 6,
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            ✎ Edit
          </button>
        )}
      </div>

      {editing ? (
        <div
          data-testid="story-edit-form"
          style={{ background: '#1a1f2e', border: '1px solid #4a5568', borderRadius: 8, padding: 16, marginBottom: 20 }}
        >
          <h3 style={{ margin: '0 0 12px', color: '#e2e8f0', fontSize: 15 }}>Edit story</h3>
          <label style={{ display: 'block', color: '#a0aec0', fontSize: 12, marginBottom: 4 }}>Title</label>
          <input
            ref={titleRef}
            data-testid="story-edit-title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#0d1117',
              border: '1px solid #4a5568',
              borderRadius: 6,
              color: '#e2e8f0',
              fontSize: 14,
              padding: '6px 10px',
              marginBottom: 12,
              outline: 'none',
            }}
          />
          <label style={{ display: 'block', color: '#a0aec0', fontSize: 12, marginBottom: 4 }}>Description</label>
          <textarea
            data-testid="story-edit-description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#0d1117',
              border: '1px solid #4a5568',
              borderRadius: 6,
              color: '#e2e8f0',
              fontSize: 13,
              padding: '6px 10px',
              marginBottom: 12,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          {saveErr && (
            <div style={{ color: '#fc8181', fontSize: 12, marginBottom: 10 }}>
              Failed to save: {saveErr}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              data-testid="story-edit-save"
              onClick={() => { void saveEdit(); }}
              disabled={saving || editTitle.trim() === ''}
              style={{
                background: saving ? '#2d3748' : '#2b6cb0',
                border: 'none',
                borderRadius: 6,
                color: '#e2e8f0',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: 12,
                padding: '5px 14px',
                opacity: editTitle.trim() === '' ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              data-testid="story-edit-cancel"
              onClick={cancelEdit}
              disabled={saving}
              style={{
                background: '#2d3748',
                border: '1px solid #4a5568',
                borderRadius: 6,
                color: '#a0aec0',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: 12,
                padding: '5px 14px',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

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
