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

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setProjects(data as Project[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ color: '#718096', padding: 32 }}>Loading projects...</div>;
  }

  return (
    <div>
      <h1 style={{ marginBottom: 20, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📁 Projects</h1>
      {projects.length === 0 ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>
          No projects found. Create a project to get started.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {projects.map(p => (
            <Link key={p.id} href={`/projects/${p.slug}`} style={{ textDecoration: 'none' }}>
              <div
                style={{
                  background: '#1a1f2e',
                  borderRadius: 8,
                  padding: 16,
                  border: `1px solid ${p.color ?? '#2d3748'}`,
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 24 }} aria-hidden="true">{p.icon ?? '📦'}</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#f0f4f8' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#718096' }}>{p.kind}</div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <span
                    style={{
                      fontSize: 10,
                      background: p.status === 'active' ? '#1c4532' : '#2d3748',
                      color: p.status === 'active' ? '#68d391' : '#a0aec0',
                      padding: '2px 6px',
                      borderRadius: 10,
                    }}
                  >
                    {p.status}
                  </span>
                </div>
                {p.liveUrl && (
                  <div style={{ fontSize: 12, color: '#63b3ed', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.liveUrl}
                  </div>
                )}
                {p.repoUrl && !p.liveUrl && (
                  <div style={{ fontSize: 12, color: '#718096', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.repoUrl}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
