// apps/dashboard/app/operations/observability/page.tsx
//
// Read-only operations page that surfaces the obs-foundation
// (PR #261 Langfuse, PR #262 router OTel, PR #264 agent OTel)
// inside the dashboard. Links out to the live Langfuse UI and
// shows the most recent trace samples from Langfuse's public API.
//
// Reference: §6.7 + §7 of
//   reports/caia-ai-tech-modernization-proposal-2026-04-30.md
// Operator runbook: caia/docs/observability-langfuse.md.

import Link from 'next/link';

interface LangfuseTrace {
  id: string;
  name: string | null;
  userId: string | null;
  timestamp: string;
  metadata?: Record<string, unknown> | null;
  observations?: number | null;
  scores?: Array<{ name: string; value: number }> | null;
}

interface ObservabilityState {
  langfuseUrl: string;
  reachable: boolean;
  reason: string | null;
  recentTraces: LangfuseTrace[];
}

const LANGFUSE_HOST = process.env.LANGFUSE_HOST ?? 'http://localhost:3001';
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY ?? '';
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY ?? '';

async function loadObservabilityState(): Promise<ObservabilityState> {
  const langfuseUrl = LANGFUSE_HOST;
  // Health check first.
  try {
    const health = await fetch(`${langfuseUrl}/api/public/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!health.ok) {
      return {
        langfuseUrl,
        reachable: false,
        reason: `health endpoint returned ${health.status}`,
        recentTraces: [],
      };
    }
  } catch (err) {
    return {
      langfuseUrl,
      reachable: false,
      reason: `health check failed: ${err instanceof Error ? err.message : String(err)}`,
      recentTraces: [],
    };
  }

  if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
    return {
      langfuseUrl,
      reachable: true,
      reason:
        'LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY env vars not set on the dashboard process — recent traces unavailable. See caia/docs/observability-langfuse.md for the dashboard env wiring.',
      recentTraces: [],
    };
  }

  // Pull last 25 traces.
  try {
    const auth = Buffer.from(
      `${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`,
    ).toString('base64');
    const res = await fetch(`${langfuseUrl}/api/public/traces?limit=25`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      return {
        langfuseUrl,
        reachable: true,
        reason: `traces endpoint returned ${res.status}`,
        recentTraces: [],
      };
    }
    const body = (await res.json()) as { data?: LangfuseTrace[] };
    return {
      langfuseUrl,
      reachable: true,
      reason: null,
      recentTraces: Array.isArray(body.data) ? body.data : [],
    };
  } catch (err) {
    return {
      langfuseUrl,
      reachable: true,
      reason: `traces fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      recentTraces: [],
    };
  }
}

export const dynamic = 'force-dynamic';

export default async function OperationsObservabilityPage() {
  const state = await loadObservabilityState();
  return (
    <main style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 600 }}>Observability</h1>
        <p style={{ marginTop: '4px', color: '#666' }}>
          Self-hosted Langfuse + OTel <code>gen_ai.*</code> trace store.
          Substrate for the AI-first feedback loop.{' '}
          <Link href="/docs/observability-langfuse" style={{ color: '#0070f3' }}>
            Operator runbook
          </Link>
          .
        </p>
      </header>

      <section
        style={{
          padding: '16px',
          background: state.reachable ? '#f0f9ff' : '#fef2f2',
          border: `1px solid ${state.reachable ? '#bae6fd' : '#fecaca'}`,
          borderRadius: '8px',
          marginBottom: '24px',
        }}
        data-testid="langfuse-status"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Langfuse:</strong>{' '}
            {state.reachable ? (
              <span style={{ color: '#0369a1' }}>healthy</span>
            ) : (
              <span style={{ color: '#b91c1c' }}>unreachable</span>
            )}
          </div>
          <a
            href={state.langfuseUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              background: '#0070f3',
              color: 'white',
              borderRadius: '4px',
              textDecoration: 'none',
              fontSize: '14px',
            }}
            data-testid="langfuse-link"
          >
            Open Langfuse UI →
          </a>
        </div>
        <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
          <code>{state.langfuseUrl}</code>
          {state.reason ? <div style={{ marginTop: '4px' }}>{state.reason}</div> : null}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '12px' }}>
          Recent traces (last 25)
        </h2>
        {state.recentTraces.length === 0 ? (
          <div
            style={{
              padding: '24px',
              border: '1px dashed #ddd',
              borderRadius: '8px',
              textAlign: 'center',
              color: '#666',
            }}
            data-testid="no-traces"
          >
            {state.reachable
              ? 'No traces yet. After the next orchestrator restart picks up the obs-002/obs-003 instrumentation, every llm.route + agent.<name> call will land here.'
              : 'Bring the Langfuse stack up first: cd caia/observability && docker compose --env-file .env.local -f docker-compose.langfuse.yml up -d'}
          </div>
        ) : (
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}
            data-testid="trace-table"
          >
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '8px' }}>Trace</th>
                <th style={{ padding: '8px' }}>User</th>
                <th style={{ padding: '8px' }}>Started</th>
                <th style={{ padding: '8px' }}>Spans</th>
                <th style={{ padding: '8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {state.recentTraces.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '8px' }}>
                    <code>{t.name ?? t.id}</code>
                  </td>
                  <td style={{ padding: '8px' }}>{t.userId ?? '-'}</td>
                  <td style={{ padding: '8px' }}>
                    {new Date(t.timestamp).toISOString()}
                  </td>
                  <td style={{ padding: '8px' }}>{t.observations ?? '-'}</td>
                  <td style={{ padding: '8px' }}>
                    <a
                      href={`${state.langfuseUrl}/trace/${encodeURIComponent(t.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#0070f3', textDecoration: 'none' }}
                    >
                      Open →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: '32px', padding: '16px', background: '#f9fafb', borderRadius: '8px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
          What lands here
        </h3>
        <ul style={{ margin: 0, paddingLeft: '20px', color: '#444', lineHeight: 1.7 }}>
          <li>
            <code>llm.route &lt;task_type&gt;</code> spans from{' '}
            <code>@chiefaia/local-llm-router</code> (PR #262) — every Claude
            binary or Ollama call.
          </li>
          <li>
            <code>agent.&lt;name&gt;</code> spans from{' '}
            <code>apps/orchestrator/src/observability/agent-otel.ts</code>{' '}
            (PR #264) — every PO / EA / BA / Validator / Test-Design call.
          </li>
          <li>
            <code>pipeline.&lt;stage&gt;</code> spans nesting agent + router
            spans by trace ID.
          </li>
          <li>
            All <code>gen_ai.*</code> attrs follow the OTel GenAI semantic
            conventions; CAIA-flavour <code>caia.*</code> attrs add task type,
            route decision, cache hit, fallback reason.
          </li>
        </ul>
      </section>
    </main>
  );
}
