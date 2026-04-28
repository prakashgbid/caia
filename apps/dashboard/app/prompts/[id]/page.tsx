'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface Prompt {
  id: string;
  body: string;
  receivedAt: string;
  receivedVia: string;
  status: string;
  correlationId: string;
  sessionId?: string | null;
  userId?: string | null;
  tokensIn?: number | null;
  elapsedMs?: number | null;
  completedAt?: string | null;
  metadataJson: string;
}

interface Descendant {
  entityType: string;
  entityId: string;
  title?: string;
  status: string;
  createdAt: string;
  parentEntityType?: string | null;
  parentEntityId?: string | null;
}

interface Event {
  id: string;
  type: string;
  occurredAt: string;
  actor: string;
  payloadJson: string;
  severity: string;
}

const STATUS_COLOR: Record<string, string> = {
  received: '#6b7280', analyzing: '#2563eb', decomposed: '#7c3aed',
  answered: '#16a34a', failed: '#dc2626',
  queued: '#9ca3af', running: '#2563eb', completed: '#16a34a',
  blocked: '#f59e0b', done: '#16a34a', failed_task: '#dc2626',
};

const ENTITY_HREF: Record<string, (id: string) => string> = {
  story: (id) => `/stories/${id}`,
  requirement: (id) => `/requirements/${id}`,
  task: (id) => `/tasks/${id}`,
  task_run: (id) => `/task-runs/${id}`,
  blocker: (id) => `/blockers/${id}`,
  question: (id) => `/questions/${id}`,
};

function chip(label: string, color: string) {
  return (
    <span style={{ background: color, color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
      {label}
    </span>
  );
}

function groupByType(descendants: Descendant[]) {
  const groups: Record<string, Descendant[]> = {};
  for (const d of descendants) {
    groups[d.entityType] = groups[d.entityType] ?? [];
    groups[d.entityType].push(d);
  }
  return groups;
}

export default function PromptDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [descendants, setDescendants] = useState<Descendant[]>([]);
  const [recentEvents, setRecentEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/prompts/${id}`).then(r => r.json()),
      fetch(`${API}/prompts/${id}/descendants`).then(r => r.json()),
      fetch(`${API}/prompts/${id}/events?limit=50`).then(r => r.json()),
    ]).then(([pd, dd, ed]) => {
      setPrompt((pd as { prompt: Prompt }).prompt ?? null);
      setDescendants((dd as { descendants: Descendant[] }).descendants ?? []);
      setRecentEvents((ed as { events: Event[] }).events ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading…</div>;
  if (!prompt) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>Prompt not found</div>
      <Link href="/prompts" style={{ color: '#63b3ed' }}>← Back to prompts</Link>
    </div>
  );

  const groups = groupByType(descendants);
  const totalDone = descendants.filter(d => ['answered', 'done', 'completed'].includes(d.status)).length;
  const pct = descendants.length > 0 ? Math.round((totalDone / descendants.length) * 100) : 0;

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      {/* Breadcrumb */}
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>
        <Link href="/prompts" style={{ color: '#6b7280' }}>Prompts</Link>
        {' → '}
        <span style={{ fontFamily: 'monospace' }}>{id.slice(0, 20)}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Prompt #{id.slice(0, 14)}</h2>
        {chip(prompt.status, STATUS_COLOR[prompt.status] ?? '#6b7280')}
        <Link href={`/prompts/${id}/journey`} style={{ marginLeft: 'auto', color: '#7c3aed', fontSize: 13 }}>
          Journey view →
        </Link>
      </div>

      {/* Prompt body */}
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'system-ui', fontSize: 13, color: '#1f2937' }}>
          {prompt.body}
        </pre>
      </div>

      {/* Metadata */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          ['Received via', prompt.receivedVia],
          ['Received at', new Date(prompt.receivedAt).toLocaleString()],
          ['Elapsed', prompt.elapsedMs != null ? `${(prompt.elapsedMs / 1000).toFixed(1)}s` : '—'],
          ['Tokens in', prompt.tokensIn ?? '—'],
          ['Session', prompt.sessionId ?? '—'],
          ['Correlation ID', prompt.correlationId.slice(0, 18)],
        ].map(([label, val]) => (
          <div key={String(label)} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#1f2937' }}>{String(val)}</div>
          </div>
        ))}
      </div>

      {/* Completion progress */}
      {descendants.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            <span>Completion — {totalDone}/{descendants.length} descendants done</span>
            <span>{pct}%</span>
          </div>
          <div style={{ background: '#e5e7eb', borderRadius: 4, height: 8 }}>
            <div style={{ background: '#16a34a', width: `${pct}%`, height: 8, borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      {/* Descendant tree */}
      <h3 style={{ marginBottom: 12 }}>Descendants ({descendants.length})</h3>
      {descendants.length === 0 && <div style={{ color: '#9ca3af', marginBottom: 20 }}>No descendants yet.</div>}
      {Object.entries(groups).map(([type, items]) => (
        <div key={type} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#374151', marginBottom: 6, textTransform: 'capitalize' }}>
            {type.replace('_', ' ')}s ({items.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {items.map(d => (
                <tr key={d.entityId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 11 }}>
                    <Link href={ENTITY_HREF[d.entityType]?.(d.entityId) ?? '#'} style={{ color: '#2563eb' }}>
                      {d.entityId.slice(0, 16)}
                    </Link>
                  </td>
                  <td style={{ padding: '5px 8px', color: '#374151' }}>{d.title ?? '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{chip(d.status, STATUS_COLOR[d.status] ?? '#6b7280')}</td>
                  <td style={{ padding: '5px 8px', color: '#9ca3af' }}>{new Date(d.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Recent events */}
      <h3 style={{ marginBottom: 12, marginTop: 24 }}>Events ({recentEvents.length})</h3>
      {recentEvents.length === 0 && <div style={{ color: '#9ca3af' }}>No events yet.</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>Type</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>Actor</th>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>Occurred at</th>
          </tr>
        </thead>
        <tbody>
          {recentEvents.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 11 }}>{e.type}</td>
              <td style={{ padding: '5px 8px', color: '#6b7280' }}>{e.actor}</td>
              <td style={{ padding: '5px 8px', color: '#9ca3af', fontSize: 11 }}>
                {new Date(e.occurredAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
