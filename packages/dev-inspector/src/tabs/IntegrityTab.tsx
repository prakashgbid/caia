'use client';

import React, { useState, useEffect } from 'react';

interface IntegrityIssue {
  type: 'broken-link' | 'dead-action';
  url?: string;
  selector?: string;
  label?: string;
}

interface IntegrityCheckResult {
  brokenLinks?: IntegrityIssue[];
  deadActions?: IntegrityIssue[];
}

declare global {
  interface Window {
    __integrityCheck?: IntegrityCheckResult;
  }
}

export function IntegrityTab() {
  const [data, setData] = useState<IntegrityCheckResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      if (window.__integrityCheck !== undefined) {
        setData(window.__integrityCheck);
        setLoaded(true);
      }
    }, 500);

    // Check immediately
    if (window.__integrityCheck !== undefined) {
      setData(window.__integrityCheck);
      setLoaded(true);
    }

    return () => clearInterval(interval);
  }, []);

  const styles: Record<string, React.CSSProperties> = {
    container: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 },
    section: { marginBottom: 12 },
    sectionTitle: { color: '#9ca3af', fontWeight: 700, marginBottom: 6, fontSize: 11, textTransform: 'uppercase' },
    item: {
      background: '#1f2937', borderRadius: 6, padding: 8,
      border: '1px solid #374151', marginBottom: 4,
    },
    url: { color: '#60a5fa', fontSize: 11, wordBreak: 'break-all' },
    selector: { color: '#a78bfa', fontSize: 11, fontFamily: 'monospace' },
    label: { color: '#d1d5db', fontSize: 11 },
    empty: { color: '#6b7280', fontSize: 11, padding: '4px 0' },
    notLoaded: { color: '#6b7280', textAlign: 'center', padding: 24 },
  };

  if (!loaded) {
    return (
      <div style={styles.notLoaded} data-testid="integrity-tab">
        integrity-check not loaded
        <div style={{ fontSize: 10, marginTop: 8, color: '#4b5563' }}>
          Install @chiefaia/integrity-check to use this tab
        </div>
      </div>
    );
  }

  const brokenLinks = data?.brokenLinks ?? [];
  const deadActions = data?.deadActions ?? [];

  return (
    <div style={styles.container} data-testid="integrity-tab">
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Broken Links ({brokenLinks.length})</div>
        {brokenLinks.length === 0 ? (
          <div style={styles.empty}>No broken links</div>
        ) : (
          brokenLinks.map((issue, i) => (
            <div key={i} style={styles.item}>
              {issue.label && <div style={styles.label}>{issue.label}</div>}
              {issue.url && <div style={styles.url}>{issue.url}</div>}
              {issue.selector && <div style={styles.selector}>{issue.selector}</div>}
            </div>
          ))
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Dead Actions ({deadActions.length})</div>
        {deadActions.length === 0 ? (
          <div style={styles.empty}>No dead actions</div>
        ) : (
          deadActions.map((issue, i) => (
            <div key={i} style={styles.item}>
              {issue.label && <div style={styles.label}>{issue.label}</div>}
              {issue.selector && <div style={styles.selector}>{issue.selector}</div>}
              {issue.url && <div style={styles.url}>{issue.url}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
