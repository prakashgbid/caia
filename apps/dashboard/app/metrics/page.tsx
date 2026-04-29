'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MetricsDashboard } from '../../components/MetricsDashboard';
import type { Metrics } from '../../components/MetricsDashboard';

function MetricsContent() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project') ?? '';
  const [metrics, setMetrics] = useState<Metrics | undefined>(undefined);

  useEffect(() => {
    const p = new URLSearchParams();
    if (project) p.set('projectId', project);
    fetch(`/api/metrics?${p.toString()}`)
      .then(r => r.json())
      .then((data: unknown) => setMetrics(data as Metrics))
      .catch(() => {});
  }, [project]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📊 Metrics</h1>
        <Link
          href="/metrics/phase1"
          style={{
            background: '#2d3748', border: '1px solid #4a5568', color: '#90cdf4',
            borderRadius: 4, padding: '6px 12px', fontSize: 12, textDecoration: 'none',
          }}
        >
          📈 Phase 1 Metrics →
        </Link>
        <Link
          href="/metrics/llm"
          style={{
            background: '#2d3748', border: '1px solid #4a5568', color: '#90cdf4',
            borderRadius: 4, padding: '6px 12px', fontSize: 12, textDecoration: 'none',
          }}
        >
          🤖 LLM routing →
        </Link>
      </div>
      <MetricsDashboard metrics={metrics} />
    </div>
  );
}

export default function MetricsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading...</div>}>
      <MetricsContent />
    </Suspense>
  );
}
