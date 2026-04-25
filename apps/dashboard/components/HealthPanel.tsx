'use client';

interface HealthData {
  ok: boolean;
  uptime?: number;
  lastEvent?: unknown;
  pendingTasks?: number;
}

function Dot({ online }: { online: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      background: online ? '#48bb78' : '#fc8181',
      marginRight: '6px',
    }} />
  );
}

function formatUptime(seconds?: number): string {
  if (seconds === undefined) return 'N/A';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function HealthPanel({ health }: { health?: HealthData }) {
  const online = health?.ok === true;

  return (
    <div style={{
      display: 'flex',
      gap: '20px',
      alignItems: 'center',
      fontSize: '13px',
      color: '#a0aec0',
    }}>
      <span>
        <Dot online={online} />
        MCP: {online ? 'online' : 'offline'}
      </span>
      {online && (
        <>
          <span>Uptime: {formatUptime(health?.uptime)}</span>
          <span>Pending: {health?.pendingTasks ?? 0}</span>
        </>
      )}
    </div>
  );
}
