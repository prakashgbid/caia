'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  entityKind: string;
  entityId: string;
  before?: string | null;
  after?: string | null;
  projectId?: string | null;
  createdAt: string;
}

const ACTOR_COLORS: Record<string, string> = {
  ai: '#2b6cb0',
  user: '#276749',
  system: '#553c9a',
};

function AuditContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const entityKind = searchParams.get('entityKind') ?? '';
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Fetch from events endpoint as proxy for audit log
    fetch('/api/events')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          let filtered = data as AuditEntry[];
          if (entityKind) filtered = filtered.filter(e => e.entityKind === entityKind);
          setEntries(filtered);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [entityKind]);

  const entityKinds = [...new Set(entries.map(e => e.entityKind))];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>🔍 Audit Log</h1>
        <select
          value={entityKind}
          onChange={e => {
            const p = new URLSearchParams(searchParams.toString());
            if (e.target.value) p.set('entityKind', e.target.value);
            else p.delete('entityKind');
            router.push(`/audit?${p.toString()}`);
          }}
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          aria-label="Filter by entity kind"
        >
          <option value="">All entities</option>
          {entityKinds.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <span style={{ fontSize: 13, color: '#718096' }}>{entries.length} entries</span>
      </div>

      {loading ? (
        <div style={{ color: '#718096', padding: 16 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {entries.map(entry => (
            <div
              key={entry.id}
              style={{
                background: '#1a1f2e',
                borderRadius: 6,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                border: '1px solid #2d3748',
              }}
            >
              <span
                style={{
                  background: ACTOR_COLORS[entry.actor] ?? '#2d3748',
                  color: '#e2e8f0',
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {entry.actor}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f6ad55', flexShrink: 0 }}>{entry.action}</span>
              <span style={{ fontSize: 12, color: '#718096', flexShrink: 0 }}>{entry.entityKind}</span>
              <Link
                href={`/audit/${entry.entityKind}/${entry.entityId}`}
                style={{ fontSize: 11, color: '#63b3ed', textDecoration: 'none', fontFamily: 'monospace' }}
              >
                {entry.entityId.slice(0, 12)}
              </Link>
              <div style={{ flex: 1 }} />
              <time
                dateTime={entry.createdAt}
                style={{ fontSize: 11, color: '#4a5568', whiteSpace: 'nowrap' }}
              >
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </div>
          ))}
          {entries.length === 0 && (
            <div style={{ color: '#718096', padding: 24, textAlign: 'center' }}>No audit entries</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading...</div>}>
      <AuditContent />
    </Suspense>
  );
}
