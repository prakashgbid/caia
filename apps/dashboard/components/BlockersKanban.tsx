'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';

type BlockerState = 'open' | 'resolved' | 'cancelled';
type BlockerSeverity = 'critical' | 'high' | 'normal' | 'low';
type BlockerKind = 'approval' | 'credentials' | 'dns' | 'external-setup' | 'info' | 'decision';

interface ResolutionStep {
  order: number;
  instruction: string;
  verification?: string;
}

interface ApprovalButton {
  label: string;
  payload: unknown;
}

interface BlockerLink {
  label: string;
  url: string;
}

interface Blocker {
  id: string;
  title: string;
  createdAt: string;
  state: BlockerState;
  severity: BlockerSeverity;
  requirementId?: string;
  taskId?: string;
  kind: BlockerKind;
  description: string;
  resolutionSteps: ResolutionStep[];
  approvalButton?: ApprovalButton;
  links?: BlockerLink[];
  resolvedAt?: string;
  resolutionNote?: string;
}

const SEVERITY_COLORS: Record<BlockerSeverity, string> = {
  critical: '#fc8181',
  high:     '#f6ad55',
  normal:   '#90cdf4',
  low:      '#9ae6b4',
};

const KIND_COLORS: Record<BlockerKind, string> = {
  approval:       '#d6bcfa',
  credentials:    '#fbd38d',
  dns:            '#81e6d9',
  'external-setup': '#f687b3',
  info:           '#90cdf4',
  decision:       '#faf089',
};

const fetcher = (url: string) => fetch(url).then(r => r.json());

const s = {
  container: { padding: '0' },
  board: { display: 'flex', gap: '16px', overflowX: 'auto' as const, paddingBottom: '8px' },
  column: {
    minWidth: '300px',
    maxWidth: '340px',
    flex: '0 0 300px',
    background: '#2d3748',
    borderRadius: '8px',
    padding: '12px',
  },
  colHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  colTitle: { fontWeight: '600', fontSize: '13px', color: '#e2e8f0', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  colCount: { background: '#4a5568', color: '#e2e8f0', borderRadius: '10px', padding: '1px 7px', fontSize: '12px' },
  card: {
    background: '#1a202c',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '10px',
    border: '1px solid #4a5568',
    transition: 'transform 0.2s ease, opacity 0.2s ease',
  },
  cardResolving: {
    transform: 'scale(0.97)',
    opacity: 0.6,
  },
  badge: {
    display: 'inline-block',
    padding: '2px 7px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: '600',
    marginRight: '4px',
    marginBottom: '4px',
    color: '#1a202c',
  },
  title: { fontSize: '14px', fontWeight: '600', color: '#f7fafc', marginBottom: '6px' },
  desc: { fontSize: '12px', color: '#a0aec0', marginBottom: '8px', lineHeight: '1.5' },
  link: { display: 'inline-block', color: '#63b3ed', fontSize: '12px', marginRight: '8px', textDecoration: 'none' },
  stepsToggle: {
    background: 'transparent',
    border: '1px solid #4a5568',
    color: '#a0aec0',
    borderRadius: '4px',
    padding: '3px 8px',
    fontSize: '11px',
    cursor: 'pointer',
    marginBottom: '8px',
  },
  step: {
    background: '#2d3748',
    borderRadius: '4px',
    padding: '8px',
    marginBottom: '4px',
    fontSize: '12px',
    color: '#e2e8f0',
  },
  stepVerify: { fontSize: '11px', color: '#68d391', marginTop: '3px' },
  approvalBtn: {
    display: 'block',
    width: '100%',
    padding: '8px',
    background: '#2b6cb0',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    fontSize: '13px',
    cursor: 'pointer',
    marginBottom: '8px',
  },
  resolveArea: { marginTop: '8px', borderTop: '1px solid #4a5568', paddingTop: '8px' },
  textarea: {
    width: '100%',
    background: '#2d3748',
    border: '1px solid #4a5568',
    borderRadius: '4px',
    color: '#e2e8f0',
    fontSize: '12px',
    padding: '6px',
    resize: 'vertical' as const,
    marginBottom: '6px',
    boxSizing: 'border-box' as const,
  },
  resolveBtn: {
    padding: '5px 12px',
    background: '#276749',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600',
  },
  empty: { color: '#4a5568', fontSize: '13px', textAlign: 'center' as const, padding: '24px 0' },
  confetti: { display: 'inline-block', animation: 'confetti-pop 0.4s ease' },
} as const;

function BlockerCard({ blocker, onResolved }: { blocker: Blocker; onResolved: () => void }) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [justResolved, setJustResolved] = useState(false);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const handleResolve = async () => {
    setResolving(true);
    try {
      await fetch(`/api/blockers/${blocker.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || undefined }),
      });
      if (!prefersReducedMotion) setJustResolved(true);
      setTimeout(() => { mutate('/api/blockers'); onResolved(); }, prefersReducedMotion ? 0 : 500);
    } catch {
      setResolving(false);
    }
  };

  const handleApprove = async () => {
    await handleResolve();
  };

  const cardStyle = {
    ...s.card,
    ...(justResolved && !prefersReducedMotion ? s.cardResolving : {}),
  };

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: '6px' }}>
        <span style={{ ...s.badge, background: SEVERITY_COLORS[blocker.severity] }}>
          {blocker.severity}
        </span>
        <span style={{ ...s.badge, background: KIND_COLORS[blocker.kind] }}>
          {blocker.kind}
        </span>
      </div>
      <div style={s.title}>{blocker.title}</div>
      <div style={s.desc}>{blocker.description}</div>

      {blocker.requirementId && (
        <div style={{ fontSize: '11px', color: '#718096', marginBottom: '6px' }}>
          Req: <span style={{ color: '#63b3ed' }}>{blocker.requirementId}</span>
        </div>
      )}

      {blocker.links && blocker.links.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          {blocker.links.map((lnk) => (
            <a key={lnk.url} href={lnk.url} target="_blank" rel="noreferrer" style={s.link}>
              {lnk.label} →
            </a>
          ))}
        </div>
      )}

      <button style={s.stepsToggle} onClick={() => setStepsOpen(!stepsOpen)}>
        {stepsOpen ? '▲ Hide' : '▼ View'} steps ({blocker.resolutionSteps.length})
      </button>

      {stepsOpen && (
        <div style={{ marginBottom: '8px' }}>
          {blocker.resolutionSteps
            .sort((a, b) => a.order - b.order)
            .map((step) => (
              <div key={step.order} style={s.step}>
                <strong>{step.order}.</strong> {step.instruction}
                {step.verification && (
                  <div style={s.stepVerify}>✓ {step.verification}</div>
                )}
              </div>
            ))}
        </div>
      )}

      {blocker.approvalButton && blocker.state === 'open' && (
        <button style={s.approvalBtn} disabled={resolving} onClick={handleApprove}>
          {justResolved
            ? <span style={prefersReducedMotion ? {} : s.confetti}>✓ Approved</span>
            : blocker.approvalButton.label}
        </button>
      )}

      {!blocker.approvalButton && blocker.state === 'open' && (
        <div style={s.resolveArea}>
          <textarea
            style={s.textarea}
            rows={2}
            placeholder="Optional resolution note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button style={s.resolveBtn} disabled={resolving} onClick={handleResolve}>
            {justResolved ? '✓ Resolved' : 'Mark resolved'}
          </button>
        </div>
      )}

      {blocker.state === 'resolved' && blocker.resolutionNote && (
        <div style={{ fontSize: '11px', color: '#68d391', marginTop: '6px' }}>
          ✓ {blocker.resolutionNote}
        </div>
      )}
    </div>
  );
}

const COLUMNS: { key: BlockerState; label: string }[] = [
  { key: 'open',      label: '🔴 Open' },
  { key: 'resolved',  label: '✅ Resolved' },
  { key: 'cancelled', label: '⛔ Cancelled' },
];

export function BlockersKanban() {
  const { data: blockers = [] } = useSWR<Blocker[]>('/api/blockers', fetcher, { refreshInterval: 4000 });
  const [_refresh, setRefresh] = useState(0);

  const byState = (state: BlockerState) => blockers.filter((b) => b.state === state);

  return (
    <div style={s.container}>
      <style>{`
        @keyframes confetti-pop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
      `}</style>
      <div style={s.board}>
        {COLUMNS.map(({ key, label }) => {
          const items = byState(key);
          return (
            <div key={key} style={s.column}>
              <div style={s.colHeader}>
                <span style={s.colTitle}>{label}</span>
                <span style={s.colCount}>{items.length}</span>
              </div>
              {items.length === 0 ? (
                <div style={s.empty}>
                  {key === 'open' ? 'Nothing waiting for you right now — Conductor is running autonomously.' : 'None yet'}
                </div>
              ) : (
                items.map((b) => (
                  <BlockerCard
                    key={b.id}
                    blocker={b}
                    onResolved={() => setRefresh((n) => n + 1)}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
