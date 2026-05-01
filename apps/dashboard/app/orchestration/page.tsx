'use client';
/**
 * Multi-agent orchestration page (VAL-2026-04-30-051730-7-multi).
 *
 * Shows the BA → PO → Coding agent collaboration pipeline as a live
 * swimlane. Fetches agent data every 15 s via SWR and subscribes to
 * the SSE bus for real-time agent status changes.
 */
import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { MultiAgentSwimlane, type AgentLaneData } from '../../components/MultiAgentSwimlane';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:7776/events';

interface RawAgent {
  id: string;
  name?: string;
  tier?: string;
  status?: string;
  queueDepth?: number;
  processedLast5m?: number;
  lastHeartbeatAt?: string | null;
  currentTask?: string | null;
}

const PIPELINE_AGENTS = ['ba-agent', 'po-agent', 'coding-agent'] as const;
const AGENT_DISPLAY: Record<string, { label: string; order: number }> = {
  'ba-agent':     { label: 'BA Agent',     order: 0 },
  'po-agent':     { label: 'PO Agent',     order: 1 },
  'coding-agent': { label: 'Coding Agent', order: 2 },
};

const HANDOFF_PAIRS: Array<[string, string]> = [
  ['BA Agent', 'PO Agent'],
  ['PO Agent', 'Coding Agent'],
];

const fetcher = (url: string) => fetch(url).then((r) => r.json()) as Promise<{ agents: RawAgent[] }>;

function buildLanes(agents: RawAgent[]): AgentLaneData[] {
  const relevant = agents.filter((a) => {
    const nameLower = (a.name ?? a.id ?? '').toLowerCase();
    return PIPELINE_AGENTS.some((p) => nameLower.includes(p.replace('-agent', '')));
  });

  const lanes: AgentLaneData[] = relevant.map((a) => {
    const key = PIPELINE_AGENTS.find((p) => (a.name ?? a.id ?? '').toLowerCase().includes(p.replace('-agent', '')));
    const display = key ? AGENT_DISPLAY[key] : undefined;
    return {
      agentId: a.id ?? '',
      name: display?.label ?? a.name ?? a.id ?? 'Unknown',
      tier: a.tier ?? '—',
      status: (a.status ?? 'registered') as AgentLaneData['status'],
      queueDepth: a.queueDepth ?? 0,
      processedLast5m: a.processedLast5m ?? 0,
      lastHeartbeatAt: a.lastHeartbeatAt ?? null,
      currentTask: a.currentTask ?? null,
      _order: display?.order ?? 99,
    } as AgentLaneData & { _order: number };
  });

  lanes.sort((a, b) => ((a as AgentLaneData & { _order: number })._order) - ((b as AgentLaneData & { _order: number })._order));
  return lanes;
}

export default function OrchestrationPage() {
  const { data, mutate } = useSWR('/api/agents', fetcher, { refreshInterval: 15_000 });
  const [runStats, setRunStats] = useState({ runCount: 0, errorCount: 0, lastRunAt: null as string | null });

  const lanes = data?.agents ? buildLanes(data.agents) : [];

  const handoffs = HANDOFF_PAIRS.map(([from, to]) => ({
    from,
    to,
    pending: lanes.find((l) => l.name === from)?.queueDepth ?? 0,
  }));

  const handleEvent = useCallback((raw: string) => {
    try {
      const evt = JSON.parse(raw) as { type?: string; payload?: unknown };
      const t = evt.type ?? '';
      if (t.startsWith('agent.') || t.startsWith('ba-agent.') || t.startsWith('po-agent.') || t.startsWith('coding-agent.')) {
        void mutate();
      }
      if (t === 'pipeline.run.completed') {
        setRunStats((prev) => ({ runCount: prev.runCount + 1, errorCount: prev.errorCount, lastRunAt: new Date().toISOString() }));
      }
      if (t === 'pipeline.run.failed') {
        setRunStats((prev) => ({ ...prev, errorCount: prev.errorCount + 1, lastRunAt: new Date().toISOString() }));
      }
    } catch {
      // ignore parse errors
    }
  }, [mutate]);

  useEffect(() => {
    let ws: WebSocket;
    let closed = false;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(WS_URL);
      ws.onmessage = (e) => handleEvent(e.data);
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000); };
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, [handleEvent]);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          Orchestration
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#718096' }}>
          Live view of the BA → PO → Coding agent collaboration pipeline. Handoffs via BullMQ.
        </p>
      </div>

      {data === undefined && (
        <div style={{ color: '#718096', fontSize: 13 }}>Loading agent data…</div>
      )}

      {data !== undefined && (
        <MultiAgentSwimlane
          lanes={lanes}
          handoffs={handoffs}
          runCount={runStats.runCount}
          errorCount={runStats.errorCount}
          lastRunAt={runStats.lastRunAt}
        />
      )}

      {/* Legend */}
      <div
        style={{
          marginTop: 24,
          padding: '12px 16px',
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 8,
          fontSize: 11,
          color: '#718096',
          lineHeight: 1.7,
        }}
        aria-label="Pipeline legend"
      >
        <strong style={{ color: '#a0aec0' }}>Pipeline:</strong>{' '}
        BA agent decomposes requirements → PO agent generates stories → Coding agent implements each story.{' '}
        Agents hand off work via BullMQ. Results aggregate in a single pipeline run record.
        <br />
        <strong style={{ color: '#a0aec0' }}>Queue depth</strong> shows pending BullMQ jobs for each agent.{' '}
        <strong style={{ color: '#a0aec0' }}>5 min</strong> is tasks processed in the last 5 minutes.
      </div>
    </div>
  );
}
