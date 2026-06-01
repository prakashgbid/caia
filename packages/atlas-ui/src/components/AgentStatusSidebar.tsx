/**
 * `<AgentStatusSidebar>` — real-time agent run status from the SSE
 * stream.
 *
 * Spec §5.5 + §11.2. Shows the most recent N events plus a connection
 * indicator. The host wires `events` from `useAtlasSse`.
 */

import * as React from 'react';
import { memo } from 'react';

import type { AtlasSseEvent } from '../types/index.js';

export interface AgentStatusSidebarProps {
  events: AtlasSseEvent[];
  connected: boolean;
  error?: Error | null;
  /** Max events to render. Default 25. */
  maxRender?: number;
  /** Fired on event row click — host MAY scroll to that ticket. */
  onEventClick?: (e: AtlasSseEvent) => void;
}

function formatTime(iso: string): string {
  // Defensive — bad input returns the original string.
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function classFor(e: AtlasSseEvent): string {
  if (e.type === 'agent.run-started') return 'atlas-sidebar__event--running';
  if (e.type === 'agent.run-finished') {
    return e.result === 'ok'
      ? 'atlas-sidebar__event--ok'
      : 'atlas-sidebar__event--fail';
  }
  return '';
}

function renderLine(e: AtlasSseEvent): string {
  switch (e.type) {
    case 'ticket.state-changed':
      return `${e.ticketId}: ${e.from} → ${e.to}`;
    case 'agent.run-started':
      return `${e.agent} started on ${e.ticketId}`;
    case 'agent.run-finished':
      return `${e.agent} ${e.result === 'ok' ? 'finished' : 'failed'} ${e.ticketId}${
        e.prUrl ? ` · PR` : ''
      }`;
    case 'design.version-rebuilt':
      return `Design rebuilt: ${e.designVersionId}`;
    case 'atlas.element.highlighted':
      return `Element highlighted: ${e.ticketId} → ${e.domId}`;
    case 'atlas.prompt.completed':
      return `Prompt ${e.result === 'ok' ? 'completed' : 'failed'} for ${e.ticketId}${
        e.versionId ? ` · ${e.versionId}` : ''
      }`;
    case 'atlas.version.changed':
      return `Design version changed: ${e.designVersionId}`;
    /* istanbul ignore next */
    default: {
      const _e: never = e;
      void _e;
      return 'unknown event';
    }
  }
}

function AgentStatusSidebarImpl(props: AgentStatusSidebarProps): React.ReactElement {
  const maxRender = props.maxRender ?? 25;
  // Newest-first.
  const visible = [...props.events].slice(-maxRender).reverse();
  return (
    <aside
      className="atlas-sidebar"
      role="region"
      aria-label="Agent activity"
      data-testid="atlas-sidebar"
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="atlas-sidebar__title">Agent activity</span>
        <span className="atlas-sidebar__connection" aria-live="polite">
          <span
            className={
              'atlas-sidebar__dot ' +
              (props.error
                ? 'atlas-sidebar__dot--error'
                : props.connected
                  ? 'atlas-sidebar__dot--live'
                  : '')
            }
            aria-hidden="true"
          />
          {props.error ? 'Disconnected' : props.connected ? 'Live' : 'Idle'}
        </span>
      </header>
      {visible.length === 0 ? (
        <div style={{ color: 'var(--atlas-text-faint)', fontSize: 12 }}>
          No agent activity yet.
        </div>
      ) : null}
      {visible.map((e, i) => {
        const key =
          'runId' in e
            ? `${e.type}:${e.runId}:${i}`
            : 'ticketId' in e
              ? `${e.type}:${e.ticketId}:${e.ts}:${i}`
              : `${e.type}:${e.ts}:${i}`;
        const cls = ['atlas-sidebar__event', classFor(e)].filter(Boolean).join(' ');
        const clickable = !!props.onEventClick;
        return (
          <div
            key={key}
            className={cls}
            tabIndex={clickable ? 0 : -1}
            onClick={clickable ? () => props.onEventClick!(e) : undefined}
            onKeyDown={
              clickable
                ? (kev) => {
                    if (kev.key === 'Enter' || kev.key === ' ') {
                      kev.preventDefault();
                      props.onEventClick!(e);
                    }
                  }
                : undefined
            }
            role={clickable ? 'button' : undefined}
            data-event-type={e.type}
          >
            <div className="atlas-sidebar__event-meta">
              <span>{e.type}</span>
              <span>{formatTime(e.ts)}</span>
            </div>
            <div className="atlas-sidebar__event-line">{renderLine(e)}</div>
          </div>
        );
      })}
    </aside>
  );
}

export const AgentStatusSidebar = memo(AgentStatusSidebarImpl);
AgentStatusSidebar.displayName = 'AgentStatusSidebar';
