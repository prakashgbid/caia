'use client';
/**
 * Multi-agent collaboration swimlane (VAL-2026-04-30-051730-7-multi).
 *
 * Visualises the BA → PO → Coding agent handoff pipeline. Each agent
 * gets its own lane showing live status, queue depth, and recent activity.
 * BullMQ handoff arrows between lanes update in real time via SSE.
 */
import { useMemo } from 'react';

export interface AgentLaneData {
  agentId: string;
  name: string;
  tier: string;
  status: 'active' | 'idle' | 'error' | 'registered' | 'disabled';
  queueDepth: number;
  processedLast5m: number;
  lastHeartbeatAt: string | null;
  currentTask?: string | null;
}

interface HandoffArrow {
  from: string;
  to: string;
  pending: number;
}

interface MultiAgentSwimlaneProps {
  lanes: AgentLaneData[];
  handoffs?: HandoffArrow[];
  runCount?: number;
  errorCount?: number;
  lastRunAt?: string | null;
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  active:     { bg: '#1a3330', color: '#68d391', label: 'Active' },
  idle:       { bg: '#1a2744', color: '#90cdf4', label: 'Idle' },
  error:      { bg: '#3d1515', color: '#fc8181', label: 'Error' },
  registered: { bg: '#1a2030', color: '#a0aec0', label: 'Registered' },
  disabled:   { bg: '#1a1a1a', color: '#718096', label: 'Disabled' },
};

function relativeTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function AgentLane({ lane }: { lane: AgentLaneData }) {
  const style = STATUS_STYLE[lane.status] ?? STATUS_STYLE['registered'];
  return (
    <div
      role="region"
      aria-label={`${lane.name} agent lane`}
      style={{
        flex: 1,
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: style.color,
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        <span style={{ fontWeight: 700, fontSize: 14, color: '#f0f4f8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lane.name}
        </span>
        <span
          style={{
            fontSize: 10,
            color: style.color,
            background: style.bg,
            border: `1px solid ${style.color}33`,
            borderRadius: 3,
            padding: '1px 5px',
          }}
          aria-label={`Status: ${style.label}`}
        >
          {style.label}
        </span>
      </div>

      {/* Tier badge */}
      <div style={{ fontSize: 11, color: '#718096' }}>
        Tier <span style={{ color: '#a0aec0', fontFamily: 'monospace' }}>{lane.tier}</span>
        {' · '}
        <span style={{ color: '#a0aec0', fontFamily: 'monospace' }}>{lane.agentId.slice(0, 8)}</span>
      </div>

      {/* Queue depth */}
      <div
        style={{
          background: '#0f1117',
          border: '1px solid #2d3748',
          borderRadius: 6,
          padding: '10px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        aria-label={`Queue depth: ${lane.queueDepth}`}
      >
        <span style={{ fontSize: 11, color: '#a0aec0' }}>Queue depth</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: lane.queueDepth > 0 ? '#f6ad55' : '#68d391', fontFamily: 'monospace' }}>
          {lane.queueDepth}
        </span>
      </div>

      {/* Throughput */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div
          style={{
            flex: 1,
            background: '#0f1117',
            border: '1px solid #2d3748',
            borderRadius: 6,
            padding: '8px 10px',
            textAlign: 'center',
          }}
          aria-label={`Processed last 5 minutes: ${lane.processedLast5m}`}
        >
          <div style={{ fontSize: 10, color: '#718096', marginBottom: 4 }}>5 min</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#90cdf4', fontFamily: 'monospace' }}>
            {lane.processedLast5m}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            background: '#0f1117',
            border: '1px solid #2d3748',
            borderRadius: 6,
            padding: '8px 10px',
            textAlign: 'center',
          }}
          aria-label={`Last heartbeat: ${relativeTime(lane.lastHeartbeatAt)}`}
        >
          <div style={{ fontSize: 10, color: '#718096', marginBottom: 4 }}>heartbeat</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#a0aec0', fontFamily: 'monospace' }}>
            {relativeTime(lane.lastHeartbeatAt)}
          </div>
        </div>
      </div>

      {/* Current task */}
      {lane.currentTask && (
        <div
          style={{
            fontSize: 11,
            color: '#a0aec0',
            background: '#0f1117',
            border: '1px solid #2d3748',
            borderRadius: 4,
            padding: '6px 8px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={lane.currentTask}
          aria-label={`Current task: ${lane.currentTask}`}
        >
          {lane.currentTask}
        </div>
      )}
    </div>
  );
}

function HandoffConnector({ handoff }: { handoff: HandoffArrow }) {
  const color = handoff.pending > 0 ? '#f6ad55' : '#4a5568';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        flexShrink: 0,
        width: 40,
      }}
      role="img"
      aria-label={`BullMQ handoff from ${handoff.from} to ${handoff.to}: ${handoff.pending} pending`}
    >
      <span style={{ fontSize: 10, color: '#718096', fontFamily: 'monospace' }}>MQ</span>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12h14M14 6l6 6-6 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {handoff.pending > 0 && (
        <span
          style={{
            fontSize: 9,
            color: '#f6ad55',
            background: '#3d2a00',
            border: '1px solid #f6ad5533',
            borderRadius: 2,
            padding: '0 3px',
            fontFamily: 'monospace',
          }}
        >
          {handoff.pending}
        </span>
      )}
    </div>
  );
}

export function MultiAgentSwimlane({
  lanes,
  handoffs = [],
  runCount = 0,
  errorCount = 0,
  lastRunAt,
}: MultiAgentSwimlaneProps) {
  const handoffMap = useMemo(() => {
    const m = new Map<string, HandoffArrow>();
    for (const h of handoffs) {
      m.set(`${h.from}→${h.to}`, h);
    }
    return m;
  }, [handoffs]);

  if (lanes.length === 0) {
    return (
      <div
        data-testid="multi-agent-swimlane-empty"
        style={{ color: '#718096', fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: 32 }}
      >
        No agent lane data available.
      </div>
    );
  }

  return (
    <section aria-labelledby="swimlane-heading" data-testid="multi-agent-swimlane">
      {/* Summary bar */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <h2
          id="swimlane-heading"
          style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#f0f4f8' }}
        >
          Multi-agent collaboration pipeline
        </h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#a0aec0' }}>
            Runs: <strong style={{ color: '#68d391' }}>{runCount}</strong>
          </span>
          {errorCount > 0 && (
            <span style={{ fontSize: 11, color: '#fc8181' }}>
              Errors: <strong>{errorCount}</strong>
            </span>
          )}
          {lastRunAt && (
            <span style={{ fontSize: 11, color: '#718096' }}>
              Last run: {relativeTime(lastRunAt)}
            </span>
          )}
        </div>
      </div>

      {/* Swimlane */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: 0,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
        role="list"
        aria-label="Agent collaboration lanes"
      >
        {lanes.map((lane, idx) => (
          <div
            key={lane.agentId}
            style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 0', minWidth: 160 }}
            role="listitem"
          >
            <AgentLane lane={lane} />
            {idx < lanes.length - 1 && (() => {
              const next = lanes[idx + 1];
              const handoff = next ? handoffMap.get(`${lane.name}→${next.name}`) : undefined;
              return (
                <HandoffConnector
                  handoff={handoff ?? { from: lane.name, to: next?.name ?? '', pending: 0 }}
                />
              );
            })()}
          </div>
        ))}
      </div>
    </section>
  );
}
