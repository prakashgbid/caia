'use client';

type TaskStatus = 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  cwd: string;
  declaredFiles: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  blockedBy?: string[];
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  queued: '#ecc94b',
  running: '#48bb78',
  blocked: '#fc8181',
  completed: '#63b3ed',
  failed: '#fc8181',
  cancelled: '#718096',
};

function Badge({ status }: { status: TaskStatus }) {
  return (
    <span style={{
      background: STATUS_COLORS[status],
      color: '#1a202c',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: '600',
    }}>
      {status}
    </span>
  );
}

function formatAge(startedAt?: string): string {
  if (!startedAt) return '-';
  const diff = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function TaskTable({ tasks }: { tasks: Task[] }) {
  const active = tasks.filter(t => ['queued', 'running', 'blocked'].includes(t.status));

  return (
    <div style={{ background: '#1a202c', borderRadius: '8px', padding: '16px' }}>
      <h2 style={{ marginBottom: '12px', color: '#f7fafc', fontSize: '16px' }}>
        Active Tasks ({active.length})
      </h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2d3748' }}>
              {['ID', 'Title', 'Status', 'CWD', 'Age', 'Files'].map(h => (
                <th key={h} style={{ padding: '8px', textAlign: 'left', color: '#718096' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: '#718096' }}>
                  No active tasks
                </td>
              </tr>
            ) : (
              active.map(task => (
                <tr key={task.id} style={{ borderBottom: '1px solid #2d3748' }}>
                  <td style={{ padding: '8px', fontFamily: 'monospace', color: '#90cdf4' }}>{task.id}</td>
                  <td style={{ padding: '8px' }}>{task.title}</td>
                  <td style={{ padding: '8px' }}><Badge status={task.status} /></td>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px', color: '#718096' }}>
                    {task.cwd.replace(process.env['HOME'] ?? '', '~')}
                  </td>
                  <td style={{ padding: '8px' }}>{formatAge(task.startedAt)}</td>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '11px' }}>
                    {task.declaredFiles.slice(0, 2).join(', ')}
                    {task.declaredFiles.length > 2 && ` +${task.declaredFiles.length - 2}`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
