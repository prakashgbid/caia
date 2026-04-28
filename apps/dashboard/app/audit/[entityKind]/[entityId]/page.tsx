'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

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

export default function EntityAuditPage({ params }: { params: { entityKind: string; entityId: string } }) {
  const { entityKind, entityId } = params;
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/audit')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const filtered = (data as AuditEntry[]).filter(
            e => e.entityKind === entityKind && e.entityId === entityId
          );
          setEntries(filtered);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [entityKind, entityId]);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
        <Link href="/audit" style={{ color: '#63b3ed', textDecoration: 'none' }}>Audit</Link>
        {' / '}
        <span style={{ color: '#a0aec0' }}>{entityKind}</span>
        {' / '}
        <span style={{ fontFamily: 'monospace', color: '#a0aec0' }}>{entityId.slice(0, 12)}</span>
      </div>

      <h1 style={{ margin: '0 0 20px', fontSize: 18, color: '#f0f4f8' }}>
        Audit trail: {entityKind} {entityId.slice(0, 12)}
      </h1>

      {loading ? (
        <div style={{ color: '#718096', padding: 16 }}>Loading...</div>
      ) : entries.length === 0 ? (
        <div style={{ color: '#718096', padding: 24, textAlign: 'center' }}>No audit entries for this entity</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {entries.map(entry => (
            <div key={entry.id} style={{ background: '#1a1f2e', borderRadius: 8, padding: 14, border: '1px solid #2d3748' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ background: '#2d3748', color: '#e2e8f0', fontSize: 10, padding: '2px 6px', borderRadius: 6 }}>{entry.actor}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f6ad55' }}>{entry.action}</span>
                <div style={{ flex: 1 }} />
                <time dateTime={entry.createdAt} style={{ fontSize: 11, color: '#4a5568' }}>
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
              </div>

              {(entry.before ?? entry.after) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {entry.before && (
                    <div>
                      <div style={{ fontSize: 10, color: '#718096', marginBottom: 4 }}>BEFORE</div>
                      <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, color: '#a0aec0', background: '#0f1117', padding: '8px 10px', borderRadius: 4, overflow: 'auto', maxHeight: 200 }}>
                        {(() => { try { return JSON.stringify(JSON.parse(entry.before!), null, 2); } catch { return entry.before!; } })()}
                      </pre>
                    </div>
                  )}
                  {entry.after && (
                    <div>
                      <div style={{ fontSize: 10, color: '#718096', marginBottom: 4 }}>AFTER</div>
                      <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 11, color: '#68d391', background: '#0f1117', padding: '8px 10px', borderRadius: 4, overflow: 'auto', maxHeight: 200 }}>
                        {(() => { try { return JSON.stringify(JSON.parse(entry.after!), null, 2); } catch { return entry.after!; } })()}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
