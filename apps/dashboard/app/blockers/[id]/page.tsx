'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';

interface Blocker {
  id: string;
  title: string;
  description: string;
  state: string;
  severity: string;
  kind: string;
  resolutionSteps: string;
  links: string;
  approvalButton?: string | null;
  requirementId?: string | null;
  taskId?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
  projectId?: string | null;
  createdAt: string;
  rootPromptId?: string | null;
}

export default function BlockerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/blockers')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const found = (data as Blocker[]).find(b => b.id === id);
          setBlocker(found ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading...</div>;
  if (!blocker) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>Blocker not found</div>
      <Link href="/blockers" style={{ color: '#63b3ed', textDecoration: 'none' }}>← Back</Link>
    </div>
  );

  const steps = (() => { try { return JSON.parse(blocker.resolutionSteps) as string[]; } catch { return []; } })();
  const links = (() => { try { return JSON.parse(blocker.links) as string[]; } catch { return []; } })();

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
        {blocker.rootPromptId && (
          <>
            <Link href={`/prompts/${blocker.rootPromptId}`} style={{ color: '#63b3ed', textDecoration: 'none' }}>
              Prompt #{blocker.rootPromptId.slice(0, 14)}
            </Link>
            {' → '}
          </>
        )}
        <Link href="/blockers" style={{ color: '#63b3ed', textDecoration: 'none' }}>Blockers</Link>
        {' / '}
        <span style={{ color: '#a0aec0' }}>{id.slice(0, 12)}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#f0f4f8', flex: 1 }}>{blocker.title}</h1>
        <span style={{
          fontSize: 11,
          background: blocker.state === 'open' ? '#742a2a' : '#1c4532',
          color: blocker.state === 'open' ? '#fed7d7' : '#9ae6b4',
          padding: '3px 8px', borderRadius: 10
        }}>
          {blocker.state}
        </span>
        <span style={{ fontSize: 11, background: '#2d3748', color: '#e2e8f0', padding: '3px 8px', borderRadius: 10 }}>
          {blocker.severity}
        </span>
      </div>

      {blocker.description && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Description</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '12px 14px', border: '1px solid #2d3748', fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
            {blocker.description}
          </div>
        </div>
      )}

      {steps.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Resolution Steps</div>
          <ol style={{ margin: 0, paddingLeft: 20, background: '#1a1f2e', borderRadius: 6, padding: '12px 14px 12px 34px', border: '1px solid #2d3748' }}>
            {steps.map((s, i) => (
              <li key={i} style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 4 }}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {links.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Links</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '10px 14px', border: '1px solid #2d3748' }}>
            {links.map((l, i) => (
              <div key={i} style={{ fontSize: 13, color: '#63b3ed', marginBottom: 3 }}>{l}</div>
            ))}
          </div>
        </div>
      )}

      {blocker.resolvedAt && (
        <div style={{ background: '#1c4532', borderRadius: 6, padding: '12px 14px', border: '1px solid #276749', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#9ae6b4', marginBottom: 4 }}>Resolved by {blocker.resolvedBy ?? 'unknown'} at {new Date(blocker.resolvedAt).toLocaleString()}</div>
          {blocker.resolutionNote && <div style={{ fontSize: 13, color: '#e2e8f0' }}>{blocker.resolutionNote}</div>}
        </div>
      )}
    </div>
  );
}
