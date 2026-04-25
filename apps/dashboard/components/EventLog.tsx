'use client';

interface ConductorEvent {
  id: string;
  type: string;
  taskId?: string;
  timestamp: string;
  payload?: unknown;
}

const EVENT_COLORS: Record<string, string> = {
  TASK_ADDED: '#63b3ed',
  TASK_STARTED: '#48bb78',
  TASK_COMPLETED: '#68d391',
  TASK_FAILED: '#fc8181',
  TASK_CANCELLED: '#718096',
  TASK_BLOCKED: '#f6ad55',
  TASK_UNBLOCKED: '#ecc94b',
  BYPASS_LOGGED: '#fc8181',
  DEGRADED_SPAWN: '#f6ad55',
  RECONCILE_DRIFT: '#f6ad55',
  LOCK_RELEASED: '#a0aec0',
  SNAPSHOT_REBUILT: '#b794f4',
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

export function EventLog({ events }: { events: ConductorEvent[] }) {
  const recent = [...events].reverse().slice(0, 200);

  return (
    <div style={{ background: '#1a202c', borderRadius: '8px', padding: '16px' }}>
      <h2 style={{ marginBottom: '12px', color: '#f7fafc', fontSize: '16px' }}>
        Event Log ({events.length} events)
      </h2>
      <div style={{
        height: '300px',
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px',
      }}>
        {recent.length === 0 ? (
          <div style={{ color: '#718096', padding: '8px' }}>No events yet</div>
        ) : (
          recent.map(event => (
            <div key={event.id} style={{
              padding: '4px 8px',
              borderBottom: '1px solid #2d3748',
              display: 'flex',
              gap: '8px',
              alignItems: 'baseline',
            }}>
              <span style={{ color: '#718096', minWidth: '80px' }}>
                {formatTime(event.timestamp)}
              </span>
              <span style={{
                color: EVENT_COLORS[event.type] ?? '#a0aec0',
                minWidth: '160px',
              }}>
                {event.type}
              </span>
              {event.taskId && (
                <span style={{ color: '#90cdf4' }}>{event.taskId}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
