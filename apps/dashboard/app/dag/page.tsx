'use client';
import useSWR from 'swr';
import { DagView } from '../../components/DagView';

/**
 * DASH-309 — task-dependency DAG view.
 *
 * Reads from the orchestrator's GET /dag endpoint (added in this PR) and
 * renders via the existing DagView component (mermaid + edge list). SWR
 * polls every 30 s so the graph reflects priority/status changes without
 * needing a fresh page load.
 */
const fetcher = (url: string) => fetch(url).then(r => r.json());

interface DagData {
  nodes: Array<{ id: string; title: string; status: string }>;
  edges: Array<{ from: string; to: string }>;
}

export default function DagPage() {
  const { data, isLoading } = useSWR<DagData>('/api/dag', fetcher, { refreshInterval: 30000 });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          🕸️ Task Dependency Graph
        </h1>
        <span style={{ color: '#718096', fontSize: 13 }}>
          {isLoading ? 'loading…' : `${data?.nodes?.length ?? 0} tasks · ${data?.edges?.length ?? 0} edges`}
        </span>
      </div>
      <DagView dag={data} />
      <div style={{ marginTop: 16, fontSize: 12, color: '#718096' }}>
        Edges: <code>tasks.depends_on</code> → task.id. Use <code>?root=&lt;id&gt;</code> on the API for the connected cone.
      </div>
    </div>
  );
}
