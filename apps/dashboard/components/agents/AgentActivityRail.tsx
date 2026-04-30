'use client';

/**
 * AgentActivityRail — persistent right-sidebar showing currently-active
 * agents. Click-to-navigate to the agent's detail page or the in-flight
 * task. (DASH-005, "agents roaming around" widget.)
 *
 * Spec: caia/docs/dashboard-ui-conventions.md §4.
 *
 * Subscribes to the existing WS event bus via useAgentActivity. No new
 * backend code; the orchestrator endpoint /agents seeds the roster, and
 * per-agent live state is derived client-side.
 *
 * Collapsible to a 40px rail (toggle persists in localStorage).
 */

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useAgentActivity, type AgentLiveState } from '../../hooks/useAgentActivity';

const STORAGE_KEY = 'agent-rail.collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore
  }
}

function fmtElapsed(startedAt: number | null): string {
  if (!startedAt) return '';
  const ms = Date.now() - startedAt;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

function statusColor(status: AgentLiveState['status']): string {
  if (status === 'error') return '#fc8181';
  if (status === 'busy') return '#68d391';
  return '#a0aec0';
}

function AgentCard({ agent, now }: { agent: AgentLiveState; now: number }) {
  const elapsed = agent.stageStartedAt ? fmtElapsed(agent.stageStartedAt) : '';
  const headerHref = `/catalog/agents/${encodeURIComponent(agent.agentId)}`;
  const taskHref = agent.currentTaskId ? `/work/tasks/${encodeURIComponent(agent.currentTaskId)}` : null;
  const stageHref =
    agent.currentPromptId && agent.currentStage
      ? `/work/prompts/${encodeURIComponent(agent.currentPromptId)}/pipeline/${encodeURIComponent(agent.currentStage)}`
      : null;
  const lastLog = agent.recentLogs[0];

  return (
    <div
      style={{
        background: '#1a1f2e',
        border: agent.status === 'error' ? '1px solid #fc8181' : '1px solid #2d3748',
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
        fontSize: 12,
      }}
    >
      <Link
        href={headerHref}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textDecoration: 'none',
          color: '#f0f4f8',
          marginBottom: 6,
        }}
      >
        <span aria-hidden="true">🤖</span>
        <span style={{ flex: 1, fontWeight: 600 }}>{agent.displayName ?? agent.name}</span>
        <span
          style={{
            color: statusColor(agent.status),
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {agent.status}
          {elapsed ? ` ${elapsed}` : ''}
        </span>
      </Link>
      {taskHref && (
        <div style={{ marginTop: 4 }}>
          <Link href={taskHref} style={{ color: '#90cdf4', textDecoration: 'none' }}>
            ▸ task {agent.currentTaskId}
          </Link>
        </div>
      )}
      {stageHref && (
        <div style={{ marginTop: 2 }}>
          <Link href={stageHref} style={{ color: '#a0aec0', textDecoration: 'none' }}>
            stage: {agent.currentStage}
          </Link>
        </div>
      )}
      <div style={{ marginTop: 6, color: '#718096', fontSize: 11 }}>
        Today: {agent.todayCompleted} • Errors 7d: {agent.errors7d}
      </div>
      {lastLog && (
        <div
          style={{
            marginTop: 6,
            padding: '4px 6px',
            background: '#0f1117',
            borderRadius: 4,
            color: '#cbd5e0',
            fontSize: 11,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={agent.recentLogs.join('\n')}
        >
          &gt; {lastLog}
        </div>
      )}
    </div>
  );
}

function ThoughtsTicker({ agents }: { agents: AgentLiveState[] }) {
  const tickerLines = useMemo(() => {
    const all: { agent: string; line: string }[] = [];
    for (const a of agents) {
      for (const line of a.recentLogs) {
        all.push({ agent: a.displayName ?? a.name, line });
      }
    }
    return all.slice(0, 4);
  }, [agents]);

  if (tickerLines.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 12,
        padding: 10,
        background: '#0f1117',
        border: '1px solid #2d3748',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 10, color: '#718096', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Live thoughts
      </div>
      {tickerLines.map((t, i) => (
        <div
          key={i}
          style={{
            fontSize: 11,
            color: '#cbd5e0',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: 2,
          }}
        >
          <span style={{ color: '#90cdf4' }}>{t.agent}:</span> {t.line}
        </div>
      ))}
    </div>
  );
}

export function AgentActivityRail() {
  const { agents, connected } = useAgentActivity();
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());

  // Hydrate collapsed from storage.
  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);
  useEffect(() => {
    writeCollapsed(collapsed);
  }, [collapsed]);

  // Tick now once a second to refresh time-in-stage display.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (collapsed) {
    return (
      <aside
        aria-label="Agent activity (collapsed)"
        style={{
          width: 40,
          background: '#1a1f2e',
          borderLeft: '1px solid #2d3748',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0',
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand agent activity"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#90cdf4',
            fontSize: 18,
            cursor: 'pointer',
            padding: 4,
          }}
        >
          🤖
        </button>
        <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', marginTop: 12, fontSize: 11, color: '#a0aec0' }}>
          {agents.filter((a) => a.status === 'busy').length} busy
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Agent activity"
      style={{
        width: 280,
        background: '#1a1f2e',
        borderLeft: '1px solid #2d3748',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 12px 8px',
          borderBottom: '1px solid #2d3748',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: '#cbd5e0', flex: 1 }}>
          🤖 Agent activity
        </span>
        <span style={{ fontSize: 10, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ off'}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse agent activity"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#a0aec0',
            cursor: 'pointer',
            fontSize: 14,
            padding: 2,
          }}
        >
          ›
        </button>
      </div>

      <div style={{ padding: 10 }}>
        {agents.length === 0 && (
          <div style={{ fontSize: 12, color: '#718096', padding: 8 }}>
            No agents active right now.
          </div>
        )}
        {agents.map((a) => (
          <AgentCard key={a.agentId} agent={a} now={now} />
        ))}
        <ThoughtsTicker agents={agents} />
      </div>
    </aside>
  );
}

export default AgentActivityRail;
