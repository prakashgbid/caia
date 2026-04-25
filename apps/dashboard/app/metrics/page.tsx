'use client';
import { useEffect, useState, Suspense } from 'react';
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
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📊 Metrics</h1>
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
