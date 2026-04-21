'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Feature {
  id: string;
  title: string;
  description: string;
  status: string;
  phase: string;
  linkedRequirements: string;
  targetDate?: string | null;
  projectId?: string | null;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

export default function FeatureDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [feature, setFeature] = useState<Feature | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/features')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const found = (data as Feature[]).find(f => f.id === id);
          setFeature(found ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading...</div>;
  if (!feature) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>Feature not found</div>
      <Link href="/features" style={{ color: '#63b3ed', textDecoration: 'none' }}>← Back</Link>
    </div>
  );

  const linkedReqs = (() => { try { return JSON.parse(feature.linkedRequirements) as string[]; } catch { return []; } })();

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
        <Link href="/features" style={{ color: '#63b3ed', textDecoration: 'none' }}>Features</Link>
        {' / '}
        <span style={{ color: '#a0aec0' }}>{id.slice(0, 12)}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#f0f4f8', flex: 1 }}>{feature.title}</h1>
        <span style={{ fontSize: 11, background: '#2d3748', color: '#e2e8f0', padding: '3px 8px', borderRadius: 10 }}>{feature.status}</span>
        <span style={{ fontSize: 11, color: '#718096' }}>Phase {feature.phase}</span>
      </div>

      {feature.description && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Description</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '12px 14px', border: '1px solid #2d3748', fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
            {feature.description}
          </div>
        </div>
      )}

      {linkedReqs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Linked Requirements ({linkedReqs.length})</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '10px 14px', border: '1px solid #2d3748', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {linkedReqs.map((r, i) => (
              <Link key={i} href={`/requirements/${r}`} style={{ fontFamily: 'monospace', fontSize: 12, color: '#63b3ed', textDecoration: 'none' }}>{r.slice(0, 12)}</Link>
            ))}
          </div>
        </div>
      )}

      {feature.targetDate && (
        <div style={{ fontSize: 13, color: '#718096', marginBottom: 8 }}>
          Target: {new Date(feature.targetDate).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
