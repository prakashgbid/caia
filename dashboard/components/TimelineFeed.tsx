'use client';
import React from 'react';
import type { WsEvent } from '../hooks/useWebSocket';

export interface TimelineEvent {
  id: string;
  kind: string;
  subjectId: string;
  subjectKind: string;
  payload: string;
  projectId?: string | null;
  createdAt: string;
}

interface Props {
  events: TimelineEvent[];
  wsEvents?: WsEvent[];
}

const KIND_COLORS: Record<string, string> = {
  'requirement.state_changed': '#63b3ed',
  'requirement.created': '#68d391',
  'task.completed': '#68d391',
  'task.failed': '#fc8181',
  'blocker.created': '#fc8181',
  'blocker.resolved': '#68d391',
  'question.answered': '#68d391',
  'adr.created': '#f6ad55',
  'feature.created': '#b794f4',
};

function formatKind(kind: string): string {
  return kind.replace(/\./g, ' › ').replace(/_/g, ' ');
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch { return iso; }
}

export function TimelineFeed({ events, wsEvents = [] }: Props) {
  // Merge ws live events at the top
  const allKinds = [...wsEvents.map(e => ({
    id: e.id ?? String(Math.random()),
    kind: e.kind,
    subjectId: '',
    subjectKind: '',
    payload: JSON.stringify(e.payload ?? {}),
    projectId: e.projectId,
    createdAt: e.ts,
    _live: true,
  })), ...events];

  if (allKinds.length === 0) {
    return (
      <div style={{ color: '#718096', textAlign: 'center', padding: '40px' }}>
        No timeline events yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {allKinds.map((e, i) => (
        <div key={`${e.id}-${i}`} style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '8px 12px',
          background: '_live' in e && e._live ? '#1a2a1a' : '#1a202c',
          borderRadius: '6px',
          border: '1px solid',
          borderColor: '_live' in e && e._live ? '#276749' : '#2d3748',
        }}>
          <span style={{ color: '#4a5568', fontSize: '11px', minWidth: '70px', paddingTop: '1px' }}>
            {formatTime(e.createdAt)}
          </span>
          <span style={{
            padding: '1px 7px',
            borderRadius: '10px',
            fontSize: '11px',
            background: ((KIND_COLORS[e.kind] ?? '#718096') + '33'),
            color: KIND_COLORS[e.kind] ?? '#718096',
            fontWeight: '500',
            whiteSpace: 'nowrap',
          }}>
            {formatKind(e.kind)}
          </span>
          {e.subjectId && (
            <span style={{ color: '#718096', fontSize: '12px', fontFamily: 'monospace' }}>
              {e.subjectId}
            </span>
          )}
          {'_live' in e && !!(e as { _live?: unknown })._live && (
            <span style={{
              marginLeft: 'auto',
              padding: '1px 6px',
              borderRadius: '6px',
              fontSize: '10px',
              background: '#276749',
              color: '#9ae6b4',
            }}>
              live
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
