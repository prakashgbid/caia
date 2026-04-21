'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

interface Project {
  id: string;
  name: string;
  slug: string;
  status: string;
  color?: string | null;
  icon?: string | null;
}

interface Props {
  value: string | null;
  onChange: (projectId: string | null) => void;
}

export function NavProjectSelector({ value, onChange }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setProjects(data as Project[]);
      })
      .catch(() => {});
  }, []);

  if (projects.length === 0) return null;

  const active = projects.filter(p => p.status === 'active');

  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid #2d3748', marginBottom: 4 }}>
      <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        Project
      </div>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        style={{
          width: '100%',
          background: '#0f1117',
          color: '#e2e8f0',
          border: '1px solid #2d3748',
          borderRadius: 4,
          padding: '4px 6px',
          fontSize: 12,
          cursor: 'pointer',
        }}
        aria-label="Filter by project"
      >
        <option value="">All projects</option>
        {active.map(p => (
          <option key={p.id} value={p.id}>
            {p.icon ? `${p.icon} ` : ''}{p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
