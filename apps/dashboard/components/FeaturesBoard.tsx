'use client';
import React from 'react';

export interface Feature {
  id: string;
  title: string;
  description: string;
  phase: string;
  status: string;
  projectId?: string | null;
  targetDate?: string | null;
  linkedRequirements: string;
}

interface Props {
  features: Feature[];
}

const PHASES = ['1', '2', '3', 'icebox'];
const PHASE_LABELS: Record<string, string> = {
  '1': 'Phase 1 — Core',
  '2': 'Phase 2 — Growth',
  '3': 'Phase 3 — Scale',
  'icebox': 'Icebox',
};

const STATUS_COLORS: Record<string, string> = {
  planned: '#718096',
  'in-progress': '#D69E2E',
  done: '#38A169',
  cancelled: '#E53E3E',
};

export function FeaturesBoard({ features }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', overflowX: 'auto' }}>
      {PHASES.map(phase => {
        const phaseFeatures = features.filter(f => f.phase === phase);
        return (
          <div key={phase}>
            <div style={{
              padding: '8px 12px',
              background: '#2d3748',
              borderRadius: '6px',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>
                {PHASE_LABELS[phase]}
              </span>
              <span style={{
                background: '#4a5568',
                color: '#a0aec0',
                borderRadius: '10px',
                padding: '1px 7px',
                fontSize: '11px',
              }}>
                {phaseFeatures.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {phaseFeatures.map(f => (
                <div key={f.id} style={{
                  background: '#1a202c',
                  border: '1px solid #2d3748',
                  borderRadius: '6px',
                  padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ color: '#f7fafc', fontSize: '13px', fontWeight: '500', lineHeight: 1.4 }}>
                      {f.title}
                    </span>
                    <span style={{
                      padding: '1px 7px',
                      borderRadius: '10px',
                      fontSize: '10px',
                      background: (STATUS_COLORS[f.status] ?? '#718096') + '33',
                      color: STATUS_COLORS[f.status] ?? '#718096',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>
                      {f.status}
                    </span>
                  </div>
                  {f.description && (
                    <p style={{ color: '#718096', fontSize: '12px', marginTop: '6px', lineHeight: 1.5 }}>
                      {f.description}
                    </p>
                  )}
                  {f.targetDate && (
                    <div style={{ color: '#718096', fontSize: '11px', marginTop: '6px' }}>
                      Target: {f.targetDate}
                    </div>
                  )}
                </div>
              ))}
              {phaseFeatures.length === 0 && (
                <div style={{ color: '#4a5568', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
                  No features
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
