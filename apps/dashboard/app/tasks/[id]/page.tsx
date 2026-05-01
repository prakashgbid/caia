'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { NotificationsPanel } from '../../../components/NotificationsPanel';

interface Task {
  id: string;
  title: string;
  status: string;
  spawnedBy: string;
  cwd: string;
  declaredFiles: string;
  actualFiles?: string | null;
  dependsOn: string;
  notes?: string | null;
  bypassUsed: boolean;
  projectId?: string | null;
  sessionId?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  rootPromptId?: string | null;
  parentEntityType?: string | null;
  parentEntityId?: string | null;
}

export default function TaskDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tasks')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const found = (data as Task[]).find(t => t.id === id);
          setTask(found ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading...</div>;
  if (!task) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>Task not found</div>
      <Link href="/tasks" style={{ color: '#63b3ed', textDecoration: 'none' }}>← Back to tasks</Link>
    </div>
  );

  const declaredFiles = (() => { try { return JSON.parse(task.declaredFiles) as string[]; } catch { return []; } })();
  const actualFiles = (() => { try { return task.actualFiles ? JSON.parse(task.actualFiles) as string[] : []; } catch { return []; } })();

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
        {task.rootPromptId && (
          <>
            <Link href={`/prompts/${task.rootPromptId}`} style={{ color: '#63b3ed', textDecoration: 'none' }}>
              Prompt #{task.rootPromptId.slice(0, 14)}
            </Link>
            {task.parentEntityType && task.parentEntityId && (
              <>
                {' → '}
                <span style={{ color: '#a0aec0', textTransform: 'capitalize' }}>{task.parentEntityType}</span>
              </>
            )}
            {' → '}
          </>
        )}
        <Link href="/tasks" style={{ color: '#63b3ed', textDecoration: 'none' }}>Tasks</Link>
        {' / '}
        <span style={{ fontFamily: 'monospace', color: '#a0aec0' }}>{id}</span>
      </div>

      <h1 style={{ margin: '0 0 20px', fontSize: 20, color: '#f0f4f8' }}>{task.title}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Status', value: task.status },
          { label: 'Spawned By', value: task.spawnedBy },
          { label: 'Working Dir', value: task.cwd },
          { label: 'Bypass Used', value: task.bypassUsed ? 'Yes' : 'No' },
          { label: 'Created', value: new Date(task.createdAt).toLocaleString() },
          { label: 'Started', value: task.startedAt ? new Date(task.startedAt).toLocaleString() : '—' },
          { label: 'Completed', value: task.completedAt ? new Date(task.completedAt).toLocaleString() : '—' },
          { label: 'Session', value: task.sessionId ?? '—' },
        ].map(row => (
          <div key={row.label} style={{ background: '#1a1f2e', borderRadius: 6, padding: '10px 14px', border: '1px solid #2d3748' }}>
            <div style={{ fontSize: 11, color: '#718096', marginBottom: 4 }}>{row.label}</div>
            <div style={{ fontSize: 13, color: '#e2e8f0', fontFamily: row.label === 'Working Dir' || row.label === 'Session' ? 'monospace' : 'inherit' }}>
              {row.value}
            </div>
          </div>
        ))}
      </div>

      {task.notes && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Notes</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '12px 14px', border: '1px solid #2d3748', fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
            {task.notes}
          </div>
        </div>
      )}

      {declaredFiles.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Declared Files ({declaredFiles.length})</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '10px 14px', border: '1px solid #2d3748' }}>
            {declaredFiles.map((f, i) => (
              <div key={i} style={{ fontFamily: 'monospace', fontSize: 12, color: '#a0aec0', marginBottom: 2 }}>{f}</div>
            ))}
          </div>
        </div>
      )}

      {actualFiles.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Actual Files ({actualFiles.length})</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '10px 14px', border: '1px solid #2d3748' }}>
            {actualFiles.map((f, i) => (
              <div key={i} style={{ fontFamily: 'monospace', fontSize: 12, color: '#68d391', marginBottom: 2 }}>{f}</div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <NotificationsPanel taskId={task.id} limit={20} />
      </div>
    </div>
  );
}
