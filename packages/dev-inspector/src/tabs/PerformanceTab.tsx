'use client';

import React from 'react';
import type { VitalMetric } from '../hooks/useVitals';

interface PerformanceTabProps {
  vitals: Record<string, VitalMetric>;
}

const RATING_COLOR: Record<string, string> = {
  good: '#22c55e',
  'needs-improvement': '#f59e0b',
  poor: '#ef4444',
};

function formatValue(name: string, value: number): string {
  if (name === 'CLS') return value.toFixed(3);
  return `${Math.round(value)}ms`;
}

const VITAL_INFO: Record<string, { label: string; thresholds: string }> = {
  LCP: { label: 'Largest Contentful Paint', thresholds: 'Good ≤2.5s | Poor >4s' },
  INP: { label: 'Interaction to Next Paint', thresholds: 'Good ≤200ms | Poor >500ms' },
  CLS: { label: 'Cumulative Layout Shift', thresholds: 'Good ≤0.1 | Poor >0.25' },
};

const VITAL_KEYS = ['LCP', 'INP', 'CLS'];

export function PerformanceTab({ vitals }: PerformanceTabProps) {
  function valueStyle(rating: string): React.CSSProperties {
    return { fontSize: 22, fontWeight: 700, color: RATING_COLOR[rating] ?? '#9ca3af', fontFamily: 'monospace' };
  }
  function badgeStyle(rating: string): React.CSSProperties {
    return {
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      background: RATING_COLOR[rating] ?? '#6b7280', color: '#fff',
      fontWeight: 700, fontSize: 10, textTransform: 'uppercase', marginTop: 4,
    };
  }

  const styles: Record<string, React.CSSProperties> = {
    container: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 },
    card: {
      background: '#1f2937', borderRadius: 8, padding: 12,
      border: '1px solid #374151',
    },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
    metricName: { color: '#f9fafb', fontWeight: 700, fontSize: 14, letterSpacing: 1 },
    label: { color: '#6b7280', fontSize: 11, marginTop: 2 },
    thresholds: { color: '#4b5563', fontSize: 10, marginTop: 6 },
    pending: { color: '#6b7280', fontSize: 18, fontFamily: 'monospace' },
    info: { color: '#6b7280', fontSize: 11, marginTop: 8, textAlign: 'center' },
  };

  return (
    <div style={styles.container} data-testid="performance-tab">
      {VITAL_KEYS.map(key => {
        const vital = vitals[key];
        const info = VITAL_INFO[key];
        return (
          <div key={key} style={styles.card}>
            <div style={styles.header}>
              <div>
                <div style={styles.metricName}>{key}</div>
                <div style={styles.label}>{info?.label}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {vital ? (
                  <>
                    <div style={valueStyle(vital.rating)}>
                      {formatValue(key, vital.value)}
                    </div>
                    <div style={badgeStyle(vital.rating)}>
                      {vital.rating}
                    </div>
                  </>
                ) : (
                  <div style={styles.pending}>—</div>
                )}
              </div>
            </div>
            {info && <div style={styles.thresholds}>{info.thresholds}</div>}
          </div>
        );
      })}

      <div style={styles.info}>
        Metrics update as user interacts with the page
      </div>
    </div>
  );
}
