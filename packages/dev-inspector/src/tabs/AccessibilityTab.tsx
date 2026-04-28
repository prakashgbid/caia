'use client';

import React, { useState, useCallback, useEffect } from 'react';

interface AxeViolation {
  id: string;
  impact: string | null;
  description: string;
  nodes: Array<{ target: string[] }>;
}

const IMPACT_COLOR: Record<string, string> = {
  critical: '#ef4444',
  serious: '#f97316',
  moderate: '#eab308',
  minor: '#6b7280',
};

function impactColor(impact: string | null): string {
  return impact ? (IMPACT_COLOR[impact] ?? '#6b7280') : '#6b7280';
}

export function AccessibilityTab() {
  const [violations, setViolations] = useState<AxeViolation[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedSelector, setHighlightedSelector] = useState<string | null>(null);

  const runAxe = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const axe = await import('axe-core');
      const results = await axe.default.run(document.body);
      setViolations(results.violations as AxeViolation[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'axe-core failed');
    } finally {
      setRunning(false);
    }
  }, []);

  // Run on mount
  useEffect(() => { runAxe(); }, [runAxe]);

  // Highlight element on hover
  useEffect(() => {
    if (!highlightedSelector) return;
    let el: Element | null = null;
    try {
      el = document.querySelector(highlightedSelector);
    } catch {
      return;
    }
    if (!el || !(el instanceof HTMLElement)) return;

    const prev = el.style.outline;
    el.style.outline = '2px solid #ef4444';
    return () => { (el as HTMLElement).style.outline = prev; };
  }, [highlightedSelector]);

  function impactBadgeStyle(impact: string | null): React.CSSProperties {
    return {
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      background: impactColor(impact), color: '#fff', fontSize: 10,
      fontWeight: 700, marginRight: 6, textTransform: 'uppercase',
    };
  }

  const styles: Record<string, React.CSSProperties> = {
    container: { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    btn: {
      background: '#374151', border: '1px solid #4b5563', color: '#f9fafb',
      borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 11,
    },
    violation: {
      background: '#1f2937', borderRadius: 6, padding: 10,
      border: '1px solid #374151', cursor: 'default',
    },
    desc: { color: '#d1d5db', marginTop: 4 },
    nodeList: { marginTop: 6, paddingLeft: 12 },
    nodeItem: {
      color: '#9ca3af', fontSize: 11, padding: '2px 0',
      cursor: 'pointer', listStyle: 'disc',
    },
    empty: { color: '#6b7280', textAlign: 'center', padding: 24 },
  };

  return (
    <div style={styles.container} data-testid="accessibility-tab">
      <div style={styles.header}>
        <span style={{ color: '#9ca3af' }}>
          {violations.length} violation{violations.length !== 1 ? 's' : ''}
        </span>
        <button style={styles.btn} onClick={runAxe} disabled={running}>
          {running ? 'Running…' : 'Re-run'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: 11 }}>Error: {error}</div>
      )}

      {!running && violations.length === 0 && !error && (
        <div style={styles.empty}>No violations found</div>
      )}

      {violations.map(v => (
        <div key={v.id} style={styles.violation}>
          <div>
            <span style={impactBadgeStyle(v.impact)}>
              {v.impact ?? 'unknown'}
            </span>
            <span style={{ color: '#f9fafb', fontWeight: 600 }}>{v.id}</span>
          </div>
          <div style={styles.desc}>{v.description}</div>
          <ul style={styles.nodeList}>
            {v.nodes.slice(0, 5).map((node, i) => (
              <li
                key={i}
                style={styles.nodeItem}
                onMouseEnter={() => setHighlightedSelector(node.target[0] ?? null)}
                onMouseLeave={() => setHighlightedSelector(null)}
                title={node.target.join(', ')}
              >
                {node.target[0]}
              </li>
            ))}
            {v.nodes.length > 5 && (
              <li style={{ ...styles.nodeItem, listStyle: 'none', color: '#6b7280' }}>
                +{v.nodes.length - 5} more
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
