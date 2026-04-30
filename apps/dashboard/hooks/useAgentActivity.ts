'use client';

/**
 * useAgentActivity — derives a per-agent live-activity map from the
 * existing WS event feed (no new backend code).
 *
 * Spec: caia/docs/dashboard-ui-conventions.md §4.
 *
 * Behaviour:
 *   - On mount, fetches `/api/agents` (or `/agents` if available) for the
 *     agent roster. Failures are non-fatal — the hook falls back to deriving
 *     agents from observed events.
 *   - Subscribes to the WS feed via useWebSocket('ws://localhost:7776/events')
 *     and updates per-agent state in response to `task_run.*`, `task.*`,
 *     `agent.*`, and `pipeline.*` event kinds.
 *   - Computes derived fields client-side: time-in-stage, busy/idle,
 *     today-completed, errors-7d.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocket } from './useWebSocket';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

export interface AgentLiveState {
  agentId: string;
  name: string;
  displayName?: string;
  tier?: string;
  status: 'idle' | 'busy' | 'error';
  currentTaskId: string | null;
  currentPromptId: string | null;
  currentStage: string | null;
  stageStartedAt: number | null;
  todayCompleted: number;
  errors7d: number;
  recentLogs: string[];
}

const MAX_LOG_LINES = 5;

function emptyState(agentId: string, name?: string): AgentLiveState {
  return {
    agentId,
    name: name ?? agentId,
    status: 'idle',
    currentTaskId: null,
    currentPromptId: null,
    currentStage: null,
    stageStartedAt: null,
    todayCompleted: 0,
    errors7d: 0,
    recentLogs: [],
  };
}

interface RosterAgent {
  id: string;
  name?: string;
  displayName?: string;
  tier?: string;
}

export function useAgentActivity() {
  const { lastEvent, connected } = useWebSocket('ws://localhost:7776/events');
  const [agents, setAgents] = useState<Record<string, AgentLiveState>>({});
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const lastEventRef = useRef<typeof lastEvent>(null);

  // Bootstrap roster.
  useEffect(() => {
    let alive = true;
    fetch(`${API}/agents`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('roster fetch failed'))))
      .then((data: unknown) => {
        if (!alive) return;
        const list = Array.isArray(data)
          ? (data as RosterAgent[])
          : (data && typeof data === 'object' && 'agents' in data
              ? ((data as { agents: RosterAgent[] }).agents)
              : []);
        const next: Record<string, AgentLiveState> = {};
        for (const a of list) {
          const id = a.id || a.name || '';
          if (!id) continue;
          next[id] = {
            ...emptyState(id, a.displayName ?? a.name ?? id),
            displayName: a.displayName,
            tier: a.tier,
          };
        }
        setAgents((prev) => ({ ...next, ...prev }));
        setRosterLoaded(true);
      })
      .catch(() => {
        if (alive) setRosterLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Apply WS events.
  useEffect(() => {
    if (!lastEvent || lastEvent === lastEventRef.current) return;
    lastEventRef.current = lastEvent;

    const kind = lastEvent.kind ?? '';
    const payload = (lastEvent as unknown as { payload?: Record<string, unknown> }).payload ?? {};
    const agentId =
      (payload['agent_id'] as string | undefined) ??
      (payload['agentId'] as string | undefined) ??
      (payload['agent'] as string | undefined) ??
      null;
    if (!agentId) return;

    setAgents((prev) => {
      const cur = prev[agentId] ?? emptyState(agentId);
      const next: AgentLiveState = { ...cur };

      // Stage / task transitions.
      if (kind.startsWith('task_run.started') || kind.startsWith('agent.busy')) {
        next.status = 'busy';
        next.stageStartedAt = Date.now();
        next.currentStage = (payload['stage'] as string | undefined) ?? next.currentStage;
        next.currentTaskId = (payload['task_id'] as string | undefined) ?? next.currentTaskId;
        next.currentPromptId = (payload['prompt_id'] as string | undefined) ?? next.currentPromptId;
      } else if (
        kind.startsWith('task_run.completed') ||
        kind.startsWith('agent.idle') ||
        kind === 'task.completed'
      ) {
        next.status = 'idle';
        next.currentStage = null;
        next.currentTaskId = null;
        next.stageStartedAt = null;
        next.todayCompleted = (cur.todayCompleted ?? 0) + 1;
      } else if (kind.startsWith('task_run.failed') || kind.startsWith('agent.error')) {
        next.status = 'error';
        next.errors7d = (cur.errors7d ?? 0) + 1;
      } else if (kind.startsWith('pipeline.stage_changed')) {
        next.currentStage = (payload['stage'] as string | undefined) ?? next.currentStage;
        next.stageStartedAt = Date.now();
      }

      // Capture log lines.
      const message =
        (payload['message'] as string | undefined) ??
        (payload['text'] as string | undefined) ??
        null;
      if (message) {
        next.recentLogs = [message, ...cur.recentLogs].slice(0, MAX_LOG_LINES);
      }

      return { ...prev, [agentId]: next };
    });
  }, [lastEvent]);

  // Derived sorted list — busy first, then idle, errors pinned to top.
  const sortedAgents = useMemo(() => {
    const arr = Object.values(agents);
    return arr.sort((a, b) => {
      if (a.status === 'error' && b.status !== 'error') return -1;
      if (b.status === 'error' && a.status !== 'error') return 1;
      if (a.status === 'busy' && b.status !== 'busy') return -1;
      if (b.status === 'busy' && a.status !== 'busy') return 1;
      if (a.status === 'busy' && b.status === 'busy') {
        const at = a.stageStartedAt ?? 0;
        const bt = b.stageStartedAt ?? 0;
        return at - bt;
      }
      return (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name);
    });
  }, [agents]);

  return { agents: sortedAgents, connected, rosterLoaded };
}
