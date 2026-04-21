'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Requirement {
  id: string;
  title: string;
  description: string;
  state: string;
  priority: number;
  labels: string;
  spec?: string | null;
  projectId?: string | null;
  estimatedFiles: string;
  dependsOn: string;
  linkedTaskIds: string;
  scope: string;
  createdAt: string;
  updatedAt: string;
  rootPromptId?: string | null;
  parentEntityType?: string | null;
  parentEntityId?: string | null;
}

export default function RequirementDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [req, setReq] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/requirements')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const found = (data as Requirement[]).find(r => r.id === id);
          setReq(found ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading...</div>;
  if (!req) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>Requirement not found</div>
      <Link href="/requirements" style={{ color: '#63b3ed', textDecoration: 'none' }}>← Back</Link>
    </div>
  );

  const labels = (() => { try { return JSON.parse(req.labels) as string[]; } catch { return []; } })();

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
        {req.rootPromptId && (
          <>
            <Link href={`/prompts/${req.rootPromptId}`} style={{ color: '#63b3ed', textDecoration: 'none' }}>
              Prompt #{req.rootPromptId.slice(0, 14)}
            </Link>
            {' → '}
          </>
        )}
        <Link href="/requirements" style={{ color: '#63b3ed', textDecoration: 'none' }}>Requirements</Link>
        {' / '}
        <span style={{ color: '#a0aec0' }}>{id.slice(0, 12)}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#f0f4f8', flex: 1 }}>{req.title}</h1>
        <span style={{ fontSize: 11, background: '#2d3748', color: '#e2e8f0', padding: '3px 8px', borderRadius: 10 }}>{req.state}</span>
        <span style={{ fontSize: 12, color: '#718096' }}>P{req.priority}</span>
      </div>

      {labels.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {labels.map((l, i) => (
            <span key={i} style={{ background: '#2d3748', color: '#a0aec0', fontSize: 11, padding: '2px 8px', borderRadius: 10 }}>{l}</span>
          ))}
        </div>
      )}

      {req.description && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Description</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '12px 14px', border: '1px solid #2d3748', fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
            {req.description}
          </div>
        </div>
      )}

      {req.spec && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Spec</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '12px 14px', border: '1px solid #2d3748', fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {req.spec}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[
          { label: 'Scope', value: req.scope },
          { label: 'Project', value: req.projectId ?? 'global' },
          { label: 'Created', value: new Date(req.createdAt).toLocaleString() },
          { label: 'Updated', value: new Date(req.updatedAt).toLocaleString() },
        ].map(row => (
          <div key={row.label} style={{ background: '#1a1f2e', borderRadius: 6, padding: '10px 14px', border: '1px solid #2d3748' }}>
            <div style={{ fontSize: 11, color: '#718096', marginBottom: 3 }}>{row.label}</div>
            <div style={{ fontSize: 13, color: '#a0aec0' }}>{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
