// LAI-006 — Dashboard page that surfaces the LLM token-savings panel.

import Link from 'next/link';
import { LlmSavingsPanel } from '../../../components/LlmSavingsPanel';

export const dynamic = 'force-dynamic';

export default function LlmMetricsPage(): JSX.Element {
  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: '#f0f4f8',
          }}
        >
          🤖 LLM routing
        </h1>
        <Link
          href="/metrics"
          style={{
            background: '#2d3748',
            border: '1px solid #4a5568',
            color: '#90cdf4',
            borderRadius: 4,
            padding: '6px 12px',
            fontSize: 12,
            textDecoration: 'none',
          }}
        >
          ← all metrics
        </Link>
      </div>

      <p style={{ color: '#a0aec0', marginTop: 0, marginBottom: 16, maxWidth: 720 }}>
        Live snapshot of how the orchestrator&apos;s <code>/llm/route</code> traffic
        is splitting between local Ollama and Claude. Polled every 5 seconds
        from the orchestrator&apos;s in-memory tracker
        (<code>@chiefaia/local-llm-router</code>&apos;s
        <code> llmMetrics.snapshot()</code>).
      </p>

      <LlmSavingsPanel />
    </div>
  );
}
