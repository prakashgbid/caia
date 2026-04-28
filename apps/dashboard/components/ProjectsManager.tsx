'use client';
import React, { useState } from 'react';
import type { Project } from './ProjectSelector';

interface Props {
  projects: Project[];
  onRefresh?: () => void;
}

const KIND_ICONS: Record<string, string> = {
  site: '🌐',
  plugin: '🔌',
  framework: '📐',
  internal: '🔧',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#68d391',
  archived: '#718096',
  planned: '#63b3ed',
};

export function ProjectsManager({ projects, onRefresh }: Props) {
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  const filtered = projects
    .filter(p => !kindFilter || p.kind === kindFilter)
    .filter(p => !statusFilter || p.status === statusFilter);

  const grouped: Record<string, typeof filtered> = {};
  for (const p of filtered) {
    if (!grouped[p.kind]) grouped[p.kind] = [];
    grouped[p.kind]!.push(p);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          value={kindFilter}
          onChange={e => setKindFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            background: '#2d3748',
            border: '1px solid #4a5568',
            borderRadius: '6px',
            color: '#f7fafc',
            fontSize: '13px',
          }}
        >
          <option value="">All kinds</option>
          <option value="site">Sites</option>
          <option value="plugin">Plugins</option>
          <option value="framework">Frameworks</option>
          <option value="internal">Internal</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            background: '#2d3748',
            border: '1px solid #4a5568',
            borderRadius: '6px',
            color: '#f7fafc',
            fontSize: '13px',
          }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="planned">Planned</option>
        </select>
      </div>

      {Object.entries(grouped).map(([kind, kindProjects]) => (
        <div key={kind} style={{ marginBottom: '24px' }}>
          <h3 style={{
            color: '#a0aec0',
            fontSize: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            {KIND_ICONS[kind] ?? '📦'} {kind}s
            <span style={{
              background: '#2d3748',
              color: '#718096',
              borderRadius: '10px',
              padding: '1px 7px',
              fontSize: '11px',
            }}>
              {kindProjects.length}
            </span>
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
            {kindProjects.map(p => (
              <div key={p.id} style={{
                background: '#1a202c',
                border: '1px solid #2d3748',
                borderRadius: '8px',
                padding: '14px',
                borderLeft: `3px solid ${p.color ?? '#718096'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  {p.icon && <span style={{ fontSize: '18px' }}>{p.icon}</span>}
                  <span style={{ color: '#f7fafc', fontSize: '14px', fontWeight: '600' }}>{p.name}</span>
                </div>
                <div style={{ color: '#718096', fontSize: '11px', fontFamily: 'monospace', marginBottom: '6px' }}>
                  {p.slug}
                </div>
                <span style={{
                  padding: '1px 7px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  background: (STATUS_COLORS[p.status] ?? '#718096') + '33',
                  color: STATUS_COLORS[p.status] ?? '#718096',
                  fontWeight: '500',
                }}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div style={{ color: '#718096', textAlign: 'center', padding: '40px' }}>
          No projects match filters.
        </div>
      )}
    </div>
  );
}
