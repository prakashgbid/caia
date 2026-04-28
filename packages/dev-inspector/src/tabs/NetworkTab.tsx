'use client';

import React from 'react';
import type { NetworkEntry } from '../hooks/useNetwork';

interface NetworkTabProps {
  entries: NetworkEntry[];
  onClear: () => void;
}

function statusColor(status: number | 'error'): string {
  if (status === 'error') return '#ef4444';
  if (status >= 500) return '#f97316';
  if (status >= 400) return '#eab308';
  return '#6b7280';
}

export function NetworkTab({ entries, onClear }: NetworkTabProps) {
  function statusStyle(s: number | 'error'): React.CSSProperties {
    return {
      fontWeight: 700, color: statusColor(s), fontSize: 10,
      padding: '1px 5px', borderRadius: 3,
      background: 'rgba(0,0,0,0.3)',
    };
  }

  const styles: Record<string, React.CSSProperties> = {
    container: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    btn: {
      background: '#374151', border: '1px solid #4b5563', color: '#f9fafb',
      borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11,
    },
    count: { color: '#9ca3af' },
    entry: {
      background: '#1f2937', borderRadius: 6, padding: '6px 8px',
      border: '1px solid #374151', fontSize: 11,
    },
    row: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 },
    method: {
      fontFamily: 'monospace', fontWeight: 700, color: '#60a5fa',
      background: '#1e3a5f', padding: '1px 5px', borderRadius: 3, fontSize: 10,
    },
    url: { color: '#d1d5db', wordBreak: 'break-all', fontSize: 11 },
    timestamp: { color: '#6b7280', fontSize: 10 },
    empty: { color: '#6b7280', textAlign: 'center', padding: 24 },
  };

  return (
    <div style={styles.container} data-testid="network-tab">
      <div style={styles.header}>
        <span style={styles.count}>
          {entries.length} failed request{entries.length !== 1 ? 's' : ''}
        </span>
        <button style={styles.btn} onClick={onClear}>Clear</button>
      </div>

      {entries.length === 0 && (
        <div style={styles.empty}>No failed requests</div>
      )}

      {entries.map(entry => (
        <div key={entry.id} style={styles.entry} data-testid="network-entry">
          <div style={styles.row}>
            <span style={styles.method}>{entry.method}</span>
            <span style={statusStyle(entry.status)}>
              {entry.status}
            </span>
            <span style={styles.timestamp}>{entry.timestamp}</span>
          </div>
          <div style={styles.url}>{entry.url}</div>
        </div>
      ))}
    </div>
  );
}
