'use client';
import { useState, useEffect } from 'react';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface EventTypeEntry {
  type: string;
  severity: string;
}

export default function ObservabilityHealthPage() {
  const [eventTypes, setEventTypes] = useState<EventTypeEntry[]>([]);
  const [recentEvents, setRecentEvents] = useState<Array<{ type: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/events/types`).then(r => r.json() as Promise<{ types: EventTypeEntry[] }>),
      fetch(`${API}/events?limit=500`).then(r => r.json() as Promise<{ events: Array<{ type: string }> }>),
    ]).then(([typesData, eventsData]) => {
      setEventTypes(typesData.types ?? []);

      // Count by type
      const counts: Record<string, number> = {};
      for (const e of eventsData.events ?? []) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
      }
      setRecentEvents(
        Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => ({ type, count }))
      );
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const seenTypes = new Set(recentEvents.map(e => e.type));
  const unseenTypes = eventTypes.filter(t => !seenTypes.has(t.type));
  const coveragePct = eventTypes.length > 0
    ? Math.round((seenTypes.size / eventTypes.length) * 100)
    : 0;

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      <h2 style={{ marginBottom: 4 }}>Observability Health</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        Which event types have been emitted vs. registered in the taxonomy.
      </p>

      {loading && <div style={{ color: '#9ca3af' }}>Loading…</div>}

      {!loading && (
        <>
          {/* Summary row */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
            <StatCard label="Registered types" value={String(eventTypes.length)} color="#374151" />
            <StatCard label="Seen in last 500 events" value={String(seenTypes.size)} color="#2563eb" />
            <StatCard label="Never emitted" value={String(unseenTypes.length)} color={unseenTypes.length > 0 ? '#d97706' : '#16a34a'} />
            <StatCard label="Coverage" value={`${coveragePct}%`} color={coveragePct >= 80 ? '#16a34a' : '#dc2626'} />
          </div>

          {/* Active types with counts */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Active event types (recent 500)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>Type</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right' }}>Count</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map(e => (
                  <tr key={e.type} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{e.type}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600 }}>{e.count}</td>
                    <td style={{ padding: '5px 10px' }}>
                      <div style={{
                        width: `${Math.min(100, Math.round((e.count / (recentEvents[0]?.count ?? 1)) * 200))}px`,
                        height: 8, background: '#2563eb', borderRadius: 4,
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Never-emitted types */}
          {unseenTypes.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13, color: '#d97706' }}>
                Never emitted ({unseenTypes.length} types)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unseenTypes.map(t => (
                  <span key={t.type} style={{
                    background: '#fff7ed', border: '1px solid #fed7aa',
                    padding: '2px 8px', borderRadius: 12, fontSize: 11, fontFamily: 'monospace',
                  }}>{t.type}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px', minWidth: 130 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{label}</div>
    </div>
  );
}
