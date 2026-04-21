'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

interface Task {
  id: string;
  title: string;
  status: string;
  spawnedBy: string;
  projectId?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  queued: '#2d3748',
  running: '#2b6cb0',
  done: '#276749',
  failed: '#742a2a',
  cancelled: '#2d3748',
  blocked: '#744210',
};

function TasksContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const project = searchParams.get('project') ?? '';
  const status = searchParams.get('status') ?? '';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/tasks')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          let filtered = data as Task[];
          if (project) filtered = filtered.filter(t => t.projectId === project);
          if (status) filtered = filtered.filter(t => t.status === status);
          setTasks(filtered);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project, status]);

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/tasks?${p.toString()}`);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📋 Tasks</h1>
        <select
          value={status}
          onChange={e => setFilter('status', e.target.value)}
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {['queued', 'running', 'done', 'failed', 'cancelled', 'blocked'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: '#718096' }}>{tasks.length} tasks</span>
      </div>

      {loading ? (
        <div style={{ color: '#718096', padding: 16 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tasks.map(task => (
            <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none' }}>
              <div
                style={{
                  background: '#1a1f2e',
                  borderRadius: 6,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  border: '1px solid #2d3748',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    background: STATUS_COLORS[task.status] ?? '#2d3748',
                    color: '#e2e8f0',
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 10,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {task.status}
                </span>
                <span style={{ flex: 1, color: '#f0f4f8', fontSize: 14 }}>{task.title}</span>
                <span style={{ fontSize: 11, color: '#718096', whiteSpace: 'nowrap' }}>
                  {task.spawnedBy}
                </span>
                <span style={{ fontSize: 11, color: '#4a5568', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {task.id.slice(0, 10)}
                </span>
              </div>
            </Link>
          ))}
          {tasks.length === 0 && (
            <div style={{ color: '#718096', padding: 24, textAlign: 'center' }}>No tasks</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading...</div>}>
      <TasksContent />
    </Suspense>
  );
}
