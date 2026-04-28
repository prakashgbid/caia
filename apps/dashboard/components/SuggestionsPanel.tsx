'use client';
import React, { useState } from 'react';

export interface Suggestion {
  id: string;
  title: string;
  rationale: string;
  options: string;
  state: string;
  acceptedOption?: string | null;
  customAnswer?: string | null;
  projectId?: string | null;
  createdAt: string;
}

interface Props {
  suggestions: Suggestion[];
  onRefresh?: () => void;
}

const CONDUCTOR_URL = typeof window !== 'undefined'
  ? (process.env['NEXT_PUBLIC_CONDUCTOR_URL'] ?? 'http://localhost:7776')
  : 'http://localhost:7776';

export function SuggestionsPanel({ suggestions, onRefresh }: Props) {
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const pending = suggestions.filter(s => s.state === 'pending');
  const resolved = suggestions.filter(s => s.state !== 'pending');

  const accept = async (id: string, option: string) => {
    await fetch(`${CONDUCTOR_URL}/suggestions/${id}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ option }),
    });
    onRefresh?.();
  };

  const submitCustom = async (id: string) => {
    const answer = customInputs[id] ?? '';
    if (!answer.trim()) return;
    await fetch(`${CONDUCTOR_URL}/suggestions/${id}/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    });
    onRefresh?.();
  };

  const parseOptions = (raw: string): Array<{ id: string; label: string; description?: string }> => {
    try { return JSON.parse(raw) as Array<{ id: string; label: string; description?: string }>; } catch { return []; }
  };

  return (
    <div>
      {pending.length === 0 && resolved.length === 0 && (
        <div style={{ color: '#718096', textAlign: 'center', padding: '40px' }}>
          No suggestions yet. AI will create suggestions proactively.
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
            Pending ({pending.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pending.map(s => {
              const opts = parseOptions(s.options);
              return (
                <div key={s.id} style={{
                  background: '#1a202c',
                  border: '1px solid #2b6cb0',
                  borderRadius: '8px',
                  padding: '16px',
                }}>
                  <h4 style={{ color: '#f7fafc', fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                    {s.title}
                  </h4>
                  <p style={{ color: '#a0aec0', fontSize: '13px', marginBottom: '12px', lineHeight: 1.5 }}>
                    {s.rationale}
                  </p>
                  {opts.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                      {opts.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => accept(s.id, opt.id)}
                          style={{
                            padding: '8px 12px',
                            background: '#2a4365',
                            border: '1px solid #2b6cb0',
                            borderRadius: '6px',
                            color: '#bee3f8',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '13px',
                          }}
                        >
                          <span style={{ fontWeight: '600' }}>{opt.label}</span>
                          {opt.description && (
                            <span style={{ color: '#718096', marginLeft: '8px' }}>{opt.description}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      value={customInputs[s.id] ?? ''}
                      onChange={e => setCustomInputs(prev => ({ ...prev, [s.id]: e.target.value }))}
                      placeholder="Custom answer..."
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        background: '#2d3748',
                        border: '1px solid #4a5568',
                        borderRadius: '6px',
                        color: '#f7fafc',
                        fontSize: '13px',
                      }}
                    />
                    <button
                      onClick={() => submitCustom(s.id)}
                      style={{
                        padding: '6px 14px',
                        background: '#2b6cb0',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      Submit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <h3 style={{ color: '#718096', fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
            Resolved ({resolved.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {resolved.map(s => (
              <div key={s.id} style={{
                background: '#1a202c',
                border: '1px solid #2d3748',
                borderRadius: '6px',
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ color: '#718096', fontSize: '13px' }}>{s.title}</span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  background: s.state === 'accepted' ? '#276749' : '#4a5568',
                  color: s.state === 'accepted' ? '#9ae6b4' : '#a0aec0',
                }}>
                  {s.state}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
