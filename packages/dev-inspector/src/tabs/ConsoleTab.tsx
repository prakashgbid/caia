'use client';

import React from 'react';
import type { ConsoleEntry } from '../hooks/useConsole';

interface ConsoleTabProps {
  entries: ConsoleEntry[];
  onClear: () => void;
}

const LEVEL_STYLE: Record<string, React.CSSProperties> = {
  error: { background: '#7f1d1d', color: '#fca5a5', border: '1px solid #ef4444' },
  warn: { background: '#78350f', color: '#fde68a', border: '1px solid #f59e0b' },
};

export function ConsoleTab({ entries, onClear }: ConsoleTabProps) {
  const styles: Record<string, React.CSSProperties> = {
    container: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    btn: {
      background: '#374151', border: '1px solid #4b5563', color: '#f9fafb',
      borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11,
    },
    count: { color: '#9ca3af' },
    entry: {
      borderRadius: 6, padding: '6px 8px',
      fontFamily: 'monospace', fontSize: 11, lineHeight: '1.4',
    },
    badge: {
      display: 'inline-block', padding: '1px 5px', borderRadius: 3,
      fontWeight: 700, fontSize: 10, textTransform: 'uppercase',
      marginRight: 6, verticalAlign: 'middle',
    },
    timestamp: { color: '#6b7280', fontSize: 10, marginBottom: 2 },
    message: { wordBreak: 'break-all', whiteSpace: 'pre-wrap' },
    empty: { color: '#6b7280', textAlign: 'center', padding: 24 },
  };

  return (
    <div style={styles.container} data-testid="console-tab">
      <div style={styles.header}>
        <span style={styles.count}>
          {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}
        </span>
        <button style={styles.btn} onClick={onClear}>Clear</button>
      </div>

      {entries.length === 0 && (
        <div style={styles.empty}>No errors or warnings captured</div>
      )}

      {entries.map(entry => (
        <div
          key={entry.id}
          style={{ ...styles.entry, ...LEVEL_STYLE[entry.level] }}
          data-testid="console-entry"
        >
          <div style={styles.timestamp}>{entry.timestamp}</div>
          <div style={styles.message}>
            <span style={{ ...styles.badge, ...LEVEL_STYLE[entry.level] }}>
              {entry.level}
            </span>
            {entry.message}
          </div>
        </div>
      ))}
    </div>
  );
}
