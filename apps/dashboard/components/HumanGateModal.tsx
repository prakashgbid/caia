'use client';
import { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type GateKind =
  | 'architecture-plan'
  | 'backlog-review'
  | 'design-review'
  | 'testing-approval'
  | 'release-approval';

type ArtifactType = 'markdown' | 'json' | 'text';

export interface HumanGateModalProps {
  gate: GateKind;
  agentName: string;
  artifactContent: string;
  artifactType: ArtifactType;
  onApprove: () => void;
  onRequestChanges: (feedback: string) => void;
  onDismiss: () => void;
}

// ─── Gate config ──────────────────────────────────────────────────────────────

const GATE_LABELS: Record<GateKind, { label: string; icon: string; color: string }> = {
  'architecture-plan':  { label: 'Architecture Plan Review',  icon: '🏗️', color: '#63b3ed' },
  'backlog-review':     { label: 'Backlog Review',            icon: '📋', color: '#9f7aea' },
  'design-review':      { label: 'Design Review',             icon: '🎨', color: '#f6ad55' },
  'testing-approval':   { label: 'Testing Approval',          icon: '🧪', color: '#68d391' },
  'release-approval':   { label: 'Release Approval',          icon: '🚀', color: '#fc8181' },
};

// ─── Artifact renderer ────────────────────────────────────────────────────────

function ArtifactRenderer({
  content,
  type,
}: {
  content: string;
  type: ArtifactType;
}) {
  if (type === 'json') {
    let formatted = content;
    try {
      formatted = JSON.stringify(JSON.parse(content), null, 2);
    } catch { /* leave as-is */ }
    return (
      <pre
        style={{
          margin: 0,
          padding: '16px',
          fontFamily: 'monospace',
          fontSize: 12,
          lineHeight: 1.6,
          color: '#e2e8f0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: '#111520',
          borderRadius: 6,
          border: '1px solid #2d3748',
          overflowY: 'auto',
          maxHeight: 360,
        }}
      >
        {formatted}
      </pre>
    );
  }

  if (type === 'markdown') {
    // Lightweight markdown rendering (no external dep)
    const lines = content.split('\n');
    return (
      <div
        style={{
          background: '#111520',
          border: '1px solid #2d3748',
          borderRadius: 6,
          padding: '16px',
          maxHeight: 360,
          overflowY: 'auto',
          fontSize: 13,
          lineHeight: 1.7,
          color: '#d1d5db',
        }}
      >
        {lines.map((line, i) => {
          if (line.startsWith('### '))
            return <h3 key={i} style={{ margin: '12px 0 4px', color: '#f0f4f8', fontSize: 14 }}>{line.slice(4)}</h3>;
          if (line.startsWith('## '))
            return <h2 key={i} style={{ margin: '16px 0 6px', color: '#90cdf4', fontSize: 15, borderBottom: '1px solid #2d3748', paddingBottom: 4 }}>{line.slice(3)}</h2>;
          if (line.startsWith('# '))
            return <h1 key={i} style={{ margin: '0 0 12px', color: '#90cdf4', fontSize: 17 }}>{line.slice(2)}</h1>;
          if (line.startsWith('- ') || line.startsWith('* '))
            return <div key={i} style={{ paddingLeft: 16, display: 'flex', gap: 6 }}><span style={{ color: '#4a5568', flexShrink: 0 }}>•</span><span>{line.slice(2)}</span></div>;
          if (line.startsWith('```'))
            return <div key={i} style={{ fontFamily: 'monospace', background: '#0d111c', padding: '2px 8px', fontSize: 12, color: '#68d391' }}>{line}</div>;
          if (line.trim() === '')
            return <div key={i} style={{ height: 8 }} />;
          return <p key={i} style={{ margin: '2px 0' }}>{line}</p>;
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#111520',
        border: '1px solid #2d3748',
        borderRadius: 6,
        padding: '16px',
        maxHeight: 360,
        overflowY: 'auto',
        fontSize: 13,
        lineHeight: 1.7,
        color: '#d1d5db',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {content}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function HumanGateModal({
  gate,
  agentName,
  artifactContent,
  artifactType,
  onApprove,
  onRequestChanges,
  onDismiss,
}: HumanGateModalProps) {
  const [mode, setMode] = useState<'review' | 'feedback'>('review');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const gateCfg = GATE_LABELS[gate];

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  // Trap focus
  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  const handleApprove = async () => {
    setSubmitting(true);
    onApprove();
  };

  const handleRequestChanges = async () => {
    if (!feedback.trim()) return;
    setSubmitting(true);
    onRequestChanges(feedback.trim());
  };

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      onClick={e => { if (e.target === e.currentTarget) onDismiss(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: 24,
      }}
      aria-modal="true"
      role="dialog"
      aria-label={`Human review gate: ${gateCfg.label}`}
    >
      <div
        style={{
          background: '#1a1f2e',
          border: `1px solid ${gateCfg.color}44`,
          borderTop: `3px solid ${gateCfg.color}`,
          borderRadius: 12,
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: `0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px ${gateCfg.color}22`,
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #2d3748',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 24 }}>{gateCfg.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: gateCfg.color,
                  background: gateCfg.color + '22',
                  padding: '2px 8px',
                  borderRadius: 10,
                  border: `1px solid ${gateCfg.color}44`,
                }}
              >
                Human Review Required
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f0f4f8' }}>
              {gateCfg.label}
            </h2>
            <div style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
              Produced by: <span style={{ color: '#a0aec0', fontWeight: 500 }}>{agentName}</span>
            </div>
          </div>
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: '#718096',
              cursor: 'pointer',
              fontSize: 18,
              padding: 4,
              lineHeight: 1,
              borderRadius: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {mode === 'review' ? (
            <>
              <div style={{ fontSize: 12, color: '#718096', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Artifact — {artifactType.toUpperCase()}
              </div>
              <ArtifactRenderer content={artifactContent} type={artifactType} />

              <div
                style={{
                  marginTop: 16,
                  padding: '10px 14px',
                  background: '#0f1117',
                  border: '1px solid #2d3748',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#718096',
                }}
              >
                💡 Review the artifact above. Approve to let the pipeline continue, or request changes to send feedback back to the agent.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: '#a0aec0', marginBottom: 10 }}>
                Describe what needs to change. The <strong style={{ color: '#e2e8f0' }}>{agentName}</strong> will receive this feedback and revise its output.
              </div>
              <textarea
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="E.g. The architecture is missing a caching layer. Please add Redis between the API and the database, and explain the cache invalidation strategy..."
                autoFocus
                style={{
                  width: '100%',
                  minHeight: 140,
                  background: '#111520',
                  border: '1px solid #4a5568',
                  borderRadius: 6,
                  color: '#e2e8f0',
                  fontSize: 13,
                  padding: '10px 12px',
                  resize: 'vertical',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  lineHeight: 1.6,
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
                onFocus={e => { e.target.style.borderColor = '#63b3ed'; }}
                onBlur={e => { e.target.style.borderColor = '#4a5568'; }}
              />
              <div style={{ fontSize: 11, color: '#4a5568', marginTop: 6, textAlign: 'right' }}>
                {feedback.length} characters
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #2d3748',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexShrink: 0,
            background: '#141821',
          }}
        >
          {mode === 'review' ? (
            <>
              <button
                onClick={handleApprove}
                disabled={submitting}
                style={{
                  background: '#276749',
                  color: '#9ae6b4',
                  border: '1px solid #276749',
                  borderRadius: 7,
                  padding: '9px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {submitting ? 'Approving…' : '✓ Approve & Continue'}
              </button>
              <button
                onClick={() => setMode('feedback')}
                disabled={submitting}
                style={{
                  background: '#7b341e',
                  color: '#fbd38d',
                  border: '1px solid #7b341e',
                  borderRadius: 7,
                  padding: '9px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                ↩ Request Changes
              </button>
              <button
                onClick={onDismiss}
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  color: '#718096',
                  border: '1px solid #2d3748',
                  borderRadius: 7,
                  padding: '9px 16px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setMode('review')}
                style={{
                  background: '#2d3748',
                  color: '#a0aec0',
                  border: '1px solid #4a5568',
                  borderRadius: 7,
                  padding: '9px 16px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <button
                onClick={handleRequestChanges}
                disabled={submitting || !feedback.trim()}
                style={{
                  background: '#7b341e',
                  color: '#fbd38d',
                  border: '1px solid #7b341e',
                  borderRadius: 7,
                  padding: '9px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: (submitting || !feedback.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (submitting || !feedback.trim()) ? 0.5 : 1,
                }}
              >
                {submitting ? 'Sending…' : '↩ Send Feedback to Agent'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
