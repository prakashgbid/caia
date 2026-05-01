'use client';
/**
 * SpikeWorkflowCard — visual progress tracker for the 4-phase spike workflow.
 *
 * A spike epic (verb intent = 'spike') decomposes into exactly 4 ordered
 * stories: Frame → Research → Evaluate → Document. This card surfaces that
 * progression with per-phase status derived from the child story statuses,
 * so engineers can see at a glance how far through the research cycle they
 * are without opening every child node.
 *
 * Usage: render inside a StoryNodeCard whenever the node is detected as a
 * spike epic (detectSpikePhases() returns ≥2 matched phases).
 */

export interface SpikePhaseState {
  key: 'frame' | 'research' | 'evaluate' | 'document';
  label: string;
  icon: string;
  titlePrefix: string;
  status: 'pending' | 'verified' | 'failed' | 'partial' | 'absent';
  storyTitle?: string;
}

const SPIKE_PHASE_DEFS: Array<Omit<SpikePhaseState, 'status' | 'storyTitle'>> = [
  { key: 'frame',    label: 'Frame',    icon: '🎯', titlePrefix: 'Frame the research question' },
  { key: 'research', label: 'Research', icon: '🔬', titlePrefix: 'Research and compare options' },
  { key: 'evaluate', label: 'Evaluate', icon: '⚖️', titlePrefix: 'Evaluate trade-offs and recommend' },
  { key: 'document', label: 'Document', icon: '📄', titlePrefix: 'Document findings in an ADR' },
];

interface ChildNode {
  title: string;
  status: string;
}

export function detectSpikePhases(children: ChildNode[]): SpikePhaseState[] {
  return SPIKE_PHASE_DEFS.map((def) => {
    const match = children.find((c) =>
      c.title.toLowerCase().startsWith(def.titlePrefix.toLowerCase()),
    );
    const rawStatus = match?.status ?? 'absent';
    const status = isKnownStatus(rawStatus) ? rawStatus : 'absent';
    return { ...def, status, storyTitle: match?.title };
  });
}

function isKnownStatus(s: string): s is SpikePhaseState['status'] {
  return ['pending', 'verified', 'failed', 'partial', 'absent'].includes(s);
}

const PHASE_STATUS_STYLES: Record<SpikePhaseState['status'], { bg: string; border: string; icon: string }> = {
  verified: { bg: '#1c3a29', border: '#68d391', icon: '✓' },
  partial:  { bg: '#2d2a1a', border: '#f6ad55', icon: '◑' },
  failed:   { bg: '#3a1c1c', border: '#fc8181', icon: '✗' },
  pending:  { bg: '#1a1f2e', border: '#4a5568', icon: '○' },
  absent:   { bg: '#141820', border: '#2d3748', icon: '—' },
};

const PHASE_STATUS_TEXT: Record<SpikePhaseState['status'], string> = {
  verified: '#68d391',
  partial:  '#f6ad55',
  failed:   '#fc8181',
  pending:  '#a0aec0',
  absent:   '#4a5568',
};

function PhaseStep({ phase, index, total }: { phase: SpikePhaseState; index: number; total: number }) {
  const style = PHASE_STATUS_STYLES[phase.status];
  const textColor = PHASE_STATUS_TEXT[phase.status];
  const isLast = index === total - 1;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
        {/* Phase box */}
        <div
          data-testid={`spike-phase-${phase.key}`}
          title={phase.storyTitle ?? `${phase.label} — ${phase.status}`}
          style={{
            width: '100%',
            background: style.bg,
            border: `1px solid ${style.border}`,
            borderRadius: 6,
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>{phase.icon}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: textColor }}>
              {phase.label}
            </span>
            <span
              data-testid={`spike-phase-status-${phase.key}`}
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                color: textColor,
                fontWeight: 700,
                fontFamily: 'monospace',
              }}
            >
              {style.icon}
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {phase.status}
          </div>
        </div>

        {/* Connector arrow between phases */}
        {!isLast && (
          <div style={{
            width: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#4a5568',
            fontSize: 12,
            padding: '2px 0',
          }}>
            →
          </div>
        )}
      </div>
    </div>
  );
}

interface SpikeWorkflowCardProps {
  phases: SpikePhaseState[];
}

export function SpikeWorkflowCard({ phases }: SpikeWorkflowCardProps) {
  const completedCount = phases.filter((p) => p.status === 'verified').length;
  const hasAnyProgress = phases.some((p) => p.status !== 'absent' && p.status !== 'pending');

  return (
    <div
      data-testid="spike-workflow-card"
      style={{
        marginTop: 10,
        background: '#0f1319',
        border: '1px solid #1d4044',
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          background: '#1d4044',
          color: '#4fd1c5',
          fontSize: 10,
          padding: '2px 8px',
          borderRadius: 4,
          fontWeight: 700,
          fontFamily: 'monospace',
          letterSpacing: '0.05em',
          border: '1px solid #4fd1c533',
        }}>
          ⚡ SPIKE WORKFLOW
        </span>
        <span style={{ color: '#4a5568', fontSize: 11 }}>
          {completedCount}/{phases.length} phases complete
        </span>
        {hasAnyProgress && completedCount === phases.length && (
          <span style={{ color: '#68d391', fontSize: 11, marginLeft: 'auto' }}>✓ Research cycle complete</span>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: '#2d3748', borderRadius: 2, marginBottom: 10, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${(completedCount / phases.length) * 100}%`,
          background: '#4fd1c5',
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Phase steps in a row */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        {phases.map((phase, i) => (
          <PhaseStep key={phase.key} phase={phase} index={i} total={phases.length} />
        ))}
      </div>

      {/* Acceptance criteria summary for current active phase */}
      {phases.map((phase) => {
        if (phase.status !== 'pending' && phase.status !== 'partial') return null;
        return (
          <div key={phase.key} style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #2d3748' }}>
            <div style={{ color: '#718096', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Current focus — {phase.label}
            </div>
            <div style={{ color: '#a0aec0', fontSize: 11 }}>{phase.storyTitle}</div>
          </div>
        );
      })}
    </div>
  );
}
