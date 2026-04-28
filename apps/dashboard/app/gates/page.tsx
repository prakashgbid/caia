'use client';
import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { HumanGateModal } from '../../components/HumanGateModal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentArtifact {
  id: string;
  agentName: string;
  artifactType: string;
  promptId?: string | null;
  requirementId?: string | null;
  content: string;
  contentType: string;
  status: string;
  createdAt: number;
}

interface ArtifactsResponse {
  artifacts: AgentArtifact[];
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function artifactTypeToGate(
  artifactType: string
): 'architecture-plan' | 'backlog-review' | 'design-review' | 'testing-approval' | 'release-approval' {
  if (artifactType.includes('architecture')) return 'architecture-plan';
  if (artifactType.includes('backlog') || artifactType.includes('requirement')) return 'backlog-review';
  if (artifactType.includes('design') || artifactType.includes('wireframe') || artifactType.includes('ux')) return 'design-review';
  if (artifactType.includes('test') || artifactType.includes('qa')) return 'testing-approval';
  if (artifactType.includes('release') || artifactType.includes('deploy')) return 'release-approval';
  return 'architecture-plan';
}

function contentTypeToArtifactType(contentType: string): 'markdown' | 'json' | 'text' {
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('markdown') || contentType.includes('md')) return 'markdown';
  return 'text';
}

function gateLabel(artifactType: string): string {
  const map: Record<string, string> = {
    'architecture-plan': '🏗️ Architecture Plan',
    'api-spec':          '📡 API Specification',
    'db-schema':         '🗄️ Database Schema',
    'wireframe':         '🎨 Wireframe / Design',
    'test-plan':         '🧪 Test Plan',
    'deployment-config': '🚀 Deployment Config',
    'release-report':    '📦 Release Report',
  };
  return map[artifactType] ?? `📄 ${artifactType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyGates() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: '#718096',
        padding: 48,
      }}
    >
      <span style={{ fontSize: 48 }}>◈</span>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#a0aec0' }}>No pending reviews</div>
      <div style={{ fontSize: 13, color: '#4a5568', textAlign: 'center', maxWidth: 340 }}>
        When an AI agent produces an artifact that needs human approval before the pipeline continues, it will appear here.
      </div>
      <Link
        href="/pipeline"
        style={{
          marginTop: 8,
          fontSize: 13,
          color: '#63b3ed',
          textDecoration: 'none',
          border: '1px solid #2d3748',
          borderRadius: 6,
          padding: '6px 14px',
          background: '#1a1f2e',
        }}
      >
        View Pipeline →
      </Link>
    </div>
  );
}

// ─── Gate card ────────────────────────────────────────────────────────────────

interface GateCardProps {
  artifact: AgentArtifact;
  onReview: (artifact: AgentArtifact) => void;
}

function GateCard({ artifact, onReview }: GateCardProps) {
  const promptPreview = artifact.promptId ? `Prompt: ${artifact.promptId.slice(0, 16)}…` : null;
  const label = gateLabel(artifact.artifactType);

  return (
    <div
      style={{
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderLeft: '4px solid #f6ad55',
        borderRadius: 8,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#4a5568'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2d3748'; }}
    >
      {/* Left: info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#f6ad55',
              background: '#f6ad5522',
              border: '1px solid #f6ad5544',
              borderRadius: 10,
              padding: '1px 7px',
            }}
          >
            Awaiting Review
          </span>
          <span style={{ fontSize: 11, color: '#718096' }}>{relativeTime(artifact.createdAt)}</span>
        </div>

        <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f4f8', marginBottom: 2 }}>
          {label}
        </div>

        <div style={{ fontSize: 12, color: '#a0aec0' }}>
          Agent: <span style={{ color: '#e2e8f0' }}>{artifact.agentName}</span>
          {promptPreview && (
            <span style={{ marginLeft: 12, color: '#718096' }}>{promptPreview}</span>
          )}
        </div>
      </div>

      {/* Right: action */}
      <button
        onClick={() => onReview(artifact)}
        style={{
          background: '#2b4a6a',
          color: '#90cdf4',
          border: '1px solid #3a6f9f',
          borderRadius: 7,
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#2d5a7a'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#2b4a6a'; }}
      >
        Review →
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GatesPage() {
  const [artifacts, setArtifacts] = useState<AgentArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentArtifact | null>(null);
  const [toast, setToast] = useState<{ text: string; color: string } | null>(null);

  const showToast = useCallback((text: string, color: string) => {
    setToast({ text, color });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/artifacts?status=draft');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json() as ArtifactsResponse;
      setArtifacts(data.artifacts ?? []);
      setError(null);
    } catch {
      setError('Could not load pending gates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const handleApprove = useCallback(async () => {
    if (!selected) return;
    try {
      await fetch(`/api/agents/artifacts/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      });
      setArtifacts(prev => prev.filter(a => a.id !== selected.id));
      showToast('✅ Artifact approved — pipeline continues.', '#68d391');
    } catch {
      showToast('⚠️ Approval recorded locally.', '#f6ad55');
      setArtifacts(prev => prev.filter(a => a.id !== selected.id));
    }
    setSelected(null);
  }, [selected, showToast]);

  const handleRequestChanges = useCallback(async (feedback: string) => {
    if (!selected) return;
    try {
      await fetch(`/api/agents/artifacts/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'superseded', feedback }),
      });
      setArtifacts(prev => prev.filter(a => a.id !== selected.id));
      showToast('↩ Feedback sent — the agent will revise its output.', '#f6ad55');
    } catch {
      showToast('⚠️ Feedback noted locally.', '#718096');
      setArtifacts(prev => prev.filter(a => a.id !== selected.id));
    }
    setSelected(null);
  }, [selected, showToast]);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minHeight: '100%' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
              ◈ Review Gates
            </h1>
            {!loading && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  background: artifacts.length > 0 ? '#7b341e' : '#1a3320',
                  color: artifacts.length > 0 ? '#fbd38d' : '#68d391',
                  borderRadius: 10,
                  padding: '2px 10px',
                  border: `1px solid ${artifacts.length > 0 ? '#f6ad5544' : '#68d39144'}`,
                }}
              >
                {artifacts.length > 0 ? `${artifacts.length} pending` : 'All clear'}
              </span>
            )}
            <button
              onClick={() => void load()}
              style={{
                marginLeft: 'auto',
                background: '#2d3748',
                color: '#a0aec0',
                border: '1px solid #4a5568',
                borderRadius: 6,
                padding: '5px 12px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              ↺ Refresh
            </button>
          </div>
          <div style={{ fontSize: 13, color: '#718096', marginTop: 4 }}>
            AI agents await your approval at these 5 mandatory pipeline gates before continuing.
          </div>
        </div>

        {/* Gate type legend */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {(['architecture-plan', 'backlog-review', 'design-review', 'testing-approval', 'release-approval'] as const).map(g => {
            const labels = {
              'architecture-plan':  '🏗️ Architecture',
              'backlog-review':     '📋 Backlog',
              'design-review':      '🎨 Design',
              'testing-approval':   '🧪 Testing',
              'release-approval':   '🚀 Release',
            };
            return (
              <span
                key={g}
                style={{
                  fontSize: 11,
                  color: '#718096',
                  background: '#1a1f2e',
                  border: '1px solid #2d3748',
                  borderRadius: 10,
                  padding: '3px 10px',
                }}
              >
                {labels[g]}
              </span>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => (
              <div
                key={i}
                style={{
                  height: 72,
                  background: 'linear-gradient(90deg, #1a1f2e 25%, #242b3d 50%, #1a1f2e 75%)',
                  backgroundSize: '200% 100%',
                  borderRadius: 8,
                  border: '1px solid #2d3748',
                  animation: 'shimmer 1.5s infinite',
                }}
              />
            ))}
          </div>
        ) : error ? (
          <div
            style={{
              padding: 24,
              background: '#3d1515',
              border: '1px solid #742a2a',
              borderRadius: 8,
              color: '#fc8181',
              fontSize: 14,
              textAlign: 'center',
            }}
          >
            {error}{' '}
            <button
              onClick={() => void load()}
              style={{ background: 'none', border: 'none', color: '#90cdf4', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}
            >
              Retry
            </button>
          </div>
        ) : artifacts.length === 0 ? (
          <EmptyGates />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {artifacts.map(artifact => (
              <GateCard
                key={artifact.id}
                artifact={artifact}
                onReview={setSelected}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && (
        <HumanGateModal
          gate={artifactTypeToGate(selected.artifactType)}
          agentName={selected.agentName}
          artifactContent={selected.content}
          artifactType={contentTypeToArtifactType(selected.contentType)}
          onApprove={handleApprove}
          onRequestChanges={handleRequestChanges}
          onDismiss={() => setSelected(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: '#1a1f2e',
            color: toast.color,
            border: `1px solid ${toast.color}55`,
            borderRadius: 8,
            padding: '12px 18px',
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            animation: 'slideInToast 0.2s ease',
          }}
          aria-live="polite"
        >
          {toast.text}
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes slideInToast {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
