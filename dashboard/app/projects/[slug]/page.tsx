'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Project {
  id: string;
  name: string;
  slug: string;
  kind: string;
  liveUrl?: string | null;
  repoUrl?: string | null;
  status: string;
  color?: string | null;
  icon?: string | null;
}

interface Metrics {
  totalTasks: number;
  completedTasks: number;
  openBlockerCount: number;
  totalRequirements: number;
  integrationHealthPct: number;
  taskCompletionRate: number;
}

const SUB_PAGES = [
  { label: 'Requirements', path: 'requirements' },
  { label: 'Tasks', path: 'tasks' },
  { label: 'Blockers', path: 'blockers' },
  { label: 'Questions', path: 'questions' },
  { label: 'Timeline', path: 'timeline' },
] as const;

export default function ProjectDetailPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const [project, setProject] = useState<Project | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const found = (data as Project[]).find(p => p.slug === slug);
          setProject(found ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!project) return;
    fetch(`/api/metrics?projectId=${project.id}`)
      .then(r => r.json())
      .then((data: unknown) => setMetrics(data as Metrics))
      .catch(() => {});
  }, [project]);

  if (loading) {
    return <div style={{ color: '#718096', padding: 32 }}>Loading project...</div>;
  }

  if (!project) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ color: '#fc8181', fontSize: 16, marginBottom: 12 }}>Project not found: {slug}</div>
        <Link href="/projects" style={{ color: '#63b3ed', textDecoration: 'none' }}>← Back to projects</Link>
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
        <Link href="/projects" style={{ color: '#63b3ed', textDecoration: 'none' }}>Projects</Link>
        {' / '}
        <span style={{ color: '#a0aec0' }}>{project.name}</span>
      </div>

      {/* Project header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <span style={{ fontSize: 40 }} aria-hidden="true">{project.icon ?? '📦'}</span>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#f0f4f8' }}>{project.name}</h1>
          <div style={{ fontSize: 13, color: '#718096', marginTop: 2 }}>{project.kind}</div>
        </div>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 12,
            background: project.status === 'active' ? '#1c4532' : '#2d3748',
            color: project.status === 'active' ? '#68d391' : '#a0aec0',
            padding: '4px 10px',
            borderRadius: 12,
          }}
        >
          {project.status}
        </span>
        {project.liveUrl && (
          <a
            href={project.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#63b3ed', fontSize: 13 }}
          >
            Live ↗
          </a>
        )}
      </div>

      {/* Metrics bar */}
      {metrics && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Tasks', value: metrics.totalTasks, color: '#63b3ed' },
            { label: 'Completed', value: metrics.completedTasks, color: '#68d391' },
            { label: 'Open Blockers', value: metrics.openBlockerCount, color: metrics.openBlockerCount > 0 ? '#fc8181' : '#68d391' },
            { label: 'Requirements', value: metrics.totalRequirements, color: '#b794f4' },
            { label: 'Health', value: `${metrics.integrationHealthPct}%`, color: metrics.integrationHealthPct >= 80 ? '#68d391' : '#f6ad55' },
          ].map(m => (
            <div
              key={m.label}
              style={{
                background: '#1a1f2e',
                borderRadius: 8,
                padding: '12px 16px',
                textAlign: 'center',
                minWidth: 90,
                border: '1px solid #2d3748',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{m.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sub-page links */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SUB_PAGES.map(sub => (
          <Link
            key={sub.path}
            href={`/projects/${slug}/${sub.path}`}
            style={{
              background: '#2d3748',
              color: '#e2e8f0',
              textDecoration: 'none',
              padding: '8px 16px',
              borderRadius: 6,
              fontSize: 14,
              border: '1px solid #4a5568',
              transition: 'background 0.15s',
            }}
          >
            {sub.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
