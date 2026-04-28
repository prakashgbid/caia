'use client';

interface Task {
  id: string;
  title: string;
  status: string;
  declaredFiles: string[];
}

function getTopDir(file: string): string {
  const parts = file.split('/');
  return parts[0] ?? file;
}

export function FileHeatMap({ tasks }: { tasks: Task[] }) {
  const runningTasks = tasks.filter(t => t.status === 'running');

  // Build directory ownership map
  const dirMap = new Map<string, { taskId: string; taskTitle: string; count: number }>();

  for (const task of runningTasks) {
    for (const file of task.declaredFiles) {
      const dir = getTopDir(file);
      const existing = dirMap.get(dir);
      if (existing) {
        existing.count++;
      } else {
        dirMap.set(dir, { taskId: task.id, taskTitle: task.title, count: 1 });
      }
    }
  }

  const entries = Array.from(dirMap.entries());

  return (
    <div style={{ background: '#1a202c', borderRadius: '8px', padding: '16px' }}>
      <h2 style={{ marginBottom: '12px', color: '#f7fafc', fontSize: '16px' }}>
        File Ownership
      </h2>
      {entries.length === 0 ? (
        <div style={{ color: '#718096', fontSize: '13px' }}>No locked files</div>
      ) : (
        <div>
          {entries.map(([dir, info]) => (
            <div key={dir} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: '1px solid #2d3748',
              fontSize: '13px',
            }}>
              <span style={{ fontFamily: 'monospace', color: '#90cdf4' }}>
                {dir}/
              </span>
              <span style={{ color: '#a0aec0' }}>
                {info.taskId} — {info.taskTitle.substring(0, 24)}
                {info.count > 1 && ` (${info.count} globs)`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
