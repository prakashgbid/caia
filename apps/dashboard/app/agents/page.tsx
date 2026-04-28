'use client';

/**
 * Agent Status Panel — /agents
 *
 * Displays all 24 CAIA agents in a responsive grid:
 *  - Name, tier, status badge, last activity timestamp
 *  - Click any card to expand recent inter-agent messages
 *  - Real-time updates via Server-Sent Events on the /events SSE stream
 */

import { useEffect, useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  displayName: string;
  tier: string;
  status: 'registered' | 'active' | 'disabled' | 'error';
  description: string;
  modelRecommendation: string;
  lastHeartbeat: number | null;
  capabilities: string[];
  updatedAt: number;
}

interface AgentMessage {
  id: string;
  fromAgent: string;
  toAgent: string;
  messageType: string;
  correlationId: string;
  payload: string;
  status: string;
  createdAt: number;
}

interface AgentDetail extends Agent {
  recentMessages: AgentMessage[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  active:     'bg-green-500',
  registered: 'bg-blue-400',
  error:      'bg-red-500',
  disabled:   'bg-gray-500',
};

const TIER_LABEL: Record<string, string> = {
  strategic:   'T1 Strategic',
  planning:    'T2 Planning',
  engineering: 'T3 Engineering',
  quality:     'T4 Quality',
  growth:      'T5 Growth',
  maintenance: 'T6 Maintenance',
};

function timeAgo(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000)  return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

// ─── Components ──────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        text-left w-full rounded-xl border p-4 transition-all
        ${selected
          ? 'border-blue-500 bg-blue-900/20 ring-1 ring-blue-500'
          : 'border-gray-700 bg-gray-800/60 hover:border-gray-500 hover:bg-gray-800'
        }
      `}
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs text-gray-400">{agent.name}</span>
        <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLOR[agent.status] ?? 'bg-gray-500'}`} />
      </div>

      <p className="font-semibold text-sm text-white truncate">{agent.displayName}</p>

      <div className="mt-2 flex items-center gap-2">
        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300">
          {TIER_LABEL[agent.tier] ?? agent.tier}
        </span>
        <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300 capitalize">
          {agent.status}
        </span>
      </div>

      <p className="mt-1.5 text-xs text-gray-500">
        Active: {timeAgo(agent.lastHeartbeat)}
      </p>
    </button>
  );
}

function MessageRow({ msg }: { msg: AgentMessage }) {
  let payloadPreview = '';
  try { payloadPreview = JSON.stringify(JSON.parse(msg.payload)).slice(0, 120); } catch { payloadPreview = msg.payload.slice(0, 120); }

  return (
    <div className="rounded bg-gray-800 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 text-gray-400 mb-0.5">
        <span className="font-mono">{msg.fromAgent}</span>
        <span>→</span>
        <span className="font-mono">{msg.toAgent}</span>
        <span className="ml-auto text-gray-600">{timeAgo(msg.createdAt)}</span>
      </div>
      <div className="text-gray-300 font-mono truncate">{payloadPreview}</div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [agents, setAgents]       = useState<Agent[]>([]);
  const [selected, setSelected]   = useState<AgentDetail | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [filter, setFilter]       = useState<string>('');

  // ── Fetch agent list ───────────────────────────────────────────────────────
  const fetchAgents = useCallback(async () => {
    try {
      const res  = await fetch('/api/agents');
      const data = await res.json() as { agents?: Agent[] };
      if (data.agents) setAgents(data.agents);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch agent detail on selection ───────────────────────────────────────
  const fetchDetail = useCallback(async (name: string) => {
    try {
      const res  = await fetch(`/api/agents/${name}`);
      const data = await res.json() as AgentDetail & { recentMessages?: AgentMessage[] };
      setSelected({ ...data, recentMessages: data.recentMessages ?? [] });
    } catch { /* keep previous selection */ }
  }, []);

  // ── SSE real-time updates ──────────────────────────────────────────────────
  useEffect(() => {
    fetchAgents().catch(() => {/* ignore */});

    const es = new EventSource('/api/events/stream');
    es.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as { type: string; payload: { agentName?: string } };
        // Refresh agent list on any agent-related event
        if (
          event.type.startsWith('testing-agent.') ||
          event.type.startsWith('release-agent.')  ||
          event.type.startsWith('ba-agent.')        ||
          event.type.startsWith('scaffolder.')
        ) {
          fetchAgents().catch(() => {/* ignore */});
          if (selected && event.payload?.agentName === selected.name) {
            fetchDetail(selected.name).catch(() => {/* ignore */});
          }
        }
      } catch { /* ignore malformed SSE */ }
    };
    es.onerror = () => es.close();

    // Also poll every 15 s as a fallback
    const poll = setInterval(() => { fetchAgents().catch(() => {/* ignore */}); }, 15_000);

    return () => { es.close(); clearInterval(poll); };
  }, [fetchAgents, fetchDetail, selected]);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const displayed = filter
    ? agents.filter(a =>
        a.name.includes(filter) ||
        a.displayName.toLowerCase().includes(filter.toLowerCase()) ||
        a.tier.includes(filter) ||
        a.status.includes(filter),
      )
    : agents;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agent Status</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {agents.length} agents registered · real-time updates via SSE
          </p>
        </div>

        <input
          type="search"
          placeholder="Filter by name, tier, status…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex gap-6">
        {/* Agent grid */}
        <div className="flex-1">
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-28 rounded-xl border border-gray-700 bg-gray-800/40 animate-pulse" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <p className="text-gray-500 text-sm">No agents match your filter.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {displayed.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={selected?.name === agent.name}
                  onClick={() => {
                    if (selected?.name === agent.name) {
                      setSelected(null);
                    } else {
                      fetchDetail(agent.name).catch(() => {/* ignore */});
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 shrink-0 rounded-xl border border-gray-700 bg-gray-900 p-4 self-start sticky top-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-sm">{selected.displayName}</h2>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-500 hover:text-white text-lg leading-none"
              >
                ×
              </button>
            </div>

            <p className="text-xs text-gray-400 mb-3">{selected.description}</p>

            <div className="space-y-1 text-xs text-gray-400 mb-4">
              <div><span className="text-gray-600">Tier:</span> {TIER_LABEL[selected.tier] ?? selected.tier}</div>
              <div><span className="text-gray-600">Model:</span> {selected.modelRecommendation}</div>
              <div><span className="text-gray-600">Status:</span> <span className="capitalize">{selected.status}</span></div>
              <div><span className="text-gray-600">Last heartbeat:</span> {timeAgo(selected.lastHeartbeat)}</div>
            </div>

            {selected.capabilities.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-gray-600 mb-1">Capabilities</p>
                <div className="flex flex-wrap gap-1">
                  {selected.capabilities.map(cap => (
                    <span key={cap} className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-gray-600 mb-2">Recent messages</p>
              {selected.recentMessages.length === 0 ? (
                <p className="text-xs text-gray-600">No messages yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {selected.recentMessages.map(msg => (
                    <MessageRow key={msg.id} msg={msg} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
