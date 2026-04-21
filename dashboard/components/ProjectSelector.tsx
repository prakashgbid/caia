'use client';
import React from 'react';

export interface Project {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  color?: string | null;
  icon?: string | null;
}

interface Props {
  projects: Project[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function ProjectSelector({ projects, selected, onSelect }: Props) {
  const selectedProject = projects.find(p => p.id === selected);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <button
        onClick={() => onSelect(null)}
        style={{
          padding: '4px 12px',
          borderRadius: '12px',
          border: '1px solid',
          borderColor: selected === null ? '#63b3ed' : '#2d3748',
          background: selected === null ? '#2a4365' : 'transparent',
          color: selected === null ? '#bee3f8' : '#718096',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: '500',
        }}
      >
        All
      </button>
      {projects.filter(p => p.status === 'active').map(p => (
        <button
          key={p.id}
          onClick={() => onSelect(selected === p.id ? null : p.id)}
          title={`${p.name} (${p.kind})`}
          style={{
            padding: '4px 12px',
            borderRadius: '12px',
            border: '1px solid',
            borderColor: selected === p.id ? (p.color ?? '#63b3ed') : '#2d3748',
            background: selected === p.id ? (p.color ? p.color + '33' : '#2a4365') : 'transparent',
            color: selected === p.id ? (p.color ?? '#bee3f8') : '#718096',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {p.icon && <span>{p.icon}</span>}
          {p.name}
        </button>
      ))}
    </div>
  );
}
