'use client';
import React from 'react';

export interface Metrics {
  integrationHealthPct: number;
  taskCompletionRate: number;
  openBlockerCount: number;
  bypassCount: number;
  avgResolutionTimeMs: number;
  totalRequirements: number;
  doneRequirements: number;
  totalTasks: number;
  completedTasks: number;
}

interface Props {
  metrics?: Metrics;
}

function GaugeBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ height: '6px', background: '#2d3748', borderRadius: '3px', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.3s' }} />
    </div>
  );
}

function MetricCard({ label, value, sub, color, gauge }: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  gauge?: number;
}) {
  return (
    <div style={{
      background: '#1a202c',
      border: '1px solid #2d3748',
      borderRadius: '8px',
      padding: '16px',
    }}>
      <div style={{ color: '#718096', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ color, fontSize: '28px', fontWeight: '700', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ color: '#718096', fontSize: '12px', marginTop: '4px' }}>{sub}</div>}
      {gauge !== undefined && (
        <div style={{ marginTop: '10px' }}>
          <GaugeBar value={gauge} color={color} />
        </div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms === 0) return 'N/A';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(ms / 1000)}s`;
}

export function MetricsDashboard({ metrics }: Props) {
  if (!metrics) {
    return (
      <div style={{ color: '#718096', textAlign: 'center', padding: '40px' }}>
        Loading metrics...
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
      <MetricCard
        label="Integration Health"
        value={`${metrics.integrationHealthPct}%`}
        color={metrics.integrationHealthPct >= 80 ? '#68d391' : metrics.integrationHealthPct >= 50 ? '#f6ad55' : '#fc8181'}
        gauge={metrics.integrationHealthPct}
        sub={`${metrics.doneRequirements} / ${metrics.totalRequirements} requirements done`}
      />
      <MetricCard
        label="Task Completion"
        value={`${metrics.taskCompletionRate}%`}
        color="#63b3ed"
        gauge={metrics.taskCompletionRate}
        sub={`${metrics.completedTasks} / ${metrics.totalTasks} tasks`}
      />
      <MetricCard
        label="Open Blockers"
        value={metrics.openBlockerCount}
        color={metrics.openBlockerCount > 0 ? '#fc8181' : '#68d391'}
        sub="needs resolution"
      />
      <MetricCard
        label="Bypass Count"
        value={metrics.bypassCount}
        color={metrics.bypassCount > 5 ? '#f6ad55' : '#718096'}
        sub="tasks with bypass"
      />
      <MetricCard
        label="Avg Resolution Time"
        value={formatDuration(metrics.avgResolutionTimeMs)}
        color="#b794f4"
        sub="for resolved blockers"
      />
    </div>
  );
}
