'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';

type QuestionState = 'open' | 'answered' | 'cancelled';
type QuestionPriority = 'urgent' | 'normal' | 'nice-to-have';

interface Recommendation {
  id: string;
  label: string;
  rationale: string;
  isDefault?: boolean;
}

interface QuestionAnswer {
  kind: 'accepted-recommendation' | 'custom';
  recommendationId?: string;
  customText?: string;
}

interface Question {
  id: string;
  title: string;
  createdAt: string;
  state: QuestionState;
  priority: QuestionPriority;
  requirementId?: string;
  taskId?: string;
  context: string;
  recommendations: Recommendation[];
  customAnswerPlaceholder?: string;
  answeredAt?: string;
  answer?: QuestionAnswer;
}

const PRIORITY_COLORS: Record<QuestionPriority, string> = {
  urgent:        '#fc8181',
  normal:        '#90cdf4',
  'nice-to-have': '#9ae6b4',
};

const fetcher = (url: string) => fetch(url).then(r => r.json());

const s = {
  container: { padding: '0' },
  board: { display: 'flex', gap: '16px', overflowX: 'auto' as const, paddingBottom: '8px' },
  column: {
    minWidth: '340px',
    maxWidth: '380px',
    flex: '0 0 340px',
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
  cardAnswering: { transform: 'scale(0.97)', opacity: 0.6 },
  badge: {
    display: 'inline-block',
    padding: '2px 7px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: '600',
    marginRight: '4px',
    marginBottom: '6px',
    color: '#1a202c',
  },
  title: { fontSize: '14px', fontWeight: '600', color: '#f7fafc', marginBottom: '6px' },
  context: {
    fontSize: '12px',
    color: '#a0aec0',
    marginBottom: '12px',
    lineHeight: '1.6',
    background: '#2d3748',
    borderRadius: '4px',
    padding: '8px',
  },
  recList: { listStyle: 'none', padding: 0, margin: '0 0 8px 0' },
  recItem: (selected: boolean, isDefault: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '8px',
    marginBottom: '6px',
    borderRadius: '6px',
    border: `1px solid ${selected ? '#63b3ed' : isDefault ? '#4a5568' : '#4a5568'}`,
    background: selected ? '#1a365d' : isDefault ? '#2d3748' : '#2d3748',
    cursor: 'pointer',
  }),
  recLabel: { fontSize: '13px', fontWeight: '600', color: '#f7fafc' },
  recRationale: { fontSize: '11px', color: '#a0aec0', marginTop: '2px', lineHeight: '1.4' },
  defaultBadge: {
    fontSize: '10px',
    background: '#2b6cb0',
    color: '#bee3f8',
    borderRadius: '4px',
    padding: '1px 5px',
    marginLeft: '6px',
  },
  radio: { marginTop: '3px', accentColor: '#63b3ed', cursor: 'pointer' },
  divider: { borderTop: '1px solid #4a5568', margin: '10px 0', color: '#718096', fontSize: '11px', textAlign: 'center' as const },
  textarea: {
    width: '100%',
    background: '#2d3748',
    border: '1px solid #4a5568',
    borderRadius: '4px',
    color: '#e2e8f0',
    fontSize: '12px',
    padding: '6px',
    resize: 'vertical' as const,
    marginBottom: '8px',
    boxSizing: 'border-box' as const,
  },
  submitBtn: {
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
  },
  answeredSummary: {
    fontSize: '12px',
    color: '#68d391',
    background: '#1c4532',
    borderRadius: '4px',
    padding: '6px 8px',
    marginTop: '8px',
  },
  empty: { color: '#4a5568', fontSize: '13px', textAlign: 'center' as const, padding: '24px 0' },
  confetti: { display: 'inline-block', animation: 'confetti-pop 0.4s ease' },
  // recommend-one styles
  recOneBox: {
    background: '#1a365d',
    border: '1px solid #2b6cb0',
    borderRadius: '6px',
    padding: '10px 12px',
    marginBottom: '10px',
  },
  recOneLabel: { fontSize: '13px', fontWeight: '700', color: '#bee3f8', marginBottom: '4px' },
  recOneRationale: { fontSize: '11px', color: '#90cdf4', lineHeight: '1.5' },
  recOneEyebrow: {
    fontSize: '10px',
    fontWeight: '600',
    color: '#4299e1',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: '6px',
  },
  recOneActions: { display: 'flex', gap: '8px', marginTop: '4px' },
  acceptBtn: {
    flex: 1,
    padding: '7px',
    background: '#276749',
    color: '#9ae6b4',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '600',
    fontSize: '13px',
    cursor: 'pointer',
  },
  overrideBtn: {
    flex: 1,
    padding: '7px',
    background: '#2d3748',
    color: '#a0aec0',
    border: '1px solid #4a5568',
    borderRadius: '6px',
    fontWeight: '600',
    fontSize: '13px',
    cursor: 'pointer',
  },
} as const;

function QuestionCard({ question, onAnswered }: { question: Question; onAnswered: () => void }) {
  const defaultRec = question.recommendations.find((r) => r.isDefault) ?? question.recommendations[0];
  const [selectedRecId, setSelectedRecId] = useState<string | null>(defaultRec?.id ?? null);
  const [customText, setCustomText] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [justAnswered, setJustAnswered] = useState(false);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const submitAnswer = async (answer: QuestionAnswer) => {
    setSubmitting(true);
    try {
      await fetch(`/api/questions/${question.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answer),
      });
      if (!prefersReducedMotion) setJustAnswered(true);
      setTimeout(() => { mutate('/api/questions'); onAnswered(); }, prefersReducedMotion ? 0 : 500);
    } catch {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    const answer: QuestionAnswer = customText.trim()
      ? { kind: 'custom', customText: customText.trim() }
      : { kind: 'accepted-recommendation', recommendationId: selectedRecId ?? undefined };
    await submitAnswer(answer);
  };

  const handleAcceptOne = async () => {
    await submitAnswer({ kind: 'accepted-recommendation', recommendationId: defaultRec?.id });
  };

  const answerSummary = (q: Question) => {
    if (!q.answer) return '';
    if (q.answer.kind === 'custom') return `Custom: ${q.answer.customText ?? ''}`;
    const rec = q.recommendations.find((r) => r.id === q.answer!.recommendationId);
    return rec ? `✓ ${rec.label}` : q.answer.recommendationId ?? '';
  };

  const cardStyle = {
    ...s.card,
    ...(justAnswered && !prefersReducedMotion ? s.cardAnswering : {}),
  };

  const isRecommendOne = question.recommendations.length === 1;

  return (
    <div style={cardStyle}>
      <span style={{ ...s.badge, background: PRIORITY_COLORS[question.priority] }}>
        {question.priority}
      </span>
      <div style={s.title}>{question.title}</div>
      <div style={s.context}>{question.context}</div>

      {question.requirementId && (
        <div style={{ fontSize: '11px', color: '#718096', marginBottom: '8px' }}>
          Req: <span style={{ color: '#63b3ed' }}>{question.requirementId}</span>
        </div>
      )}

      {question.state === 'open' && isRecommendOne && defaultRec && (
        <>
          <div style={s.recOneBox}>
            <div style={s.recOneEyebrow}>✦ AI Recommends</div>
            <div style={s.recOneLabel}>{defaultRec.label}</div>
            {defaultRec.rationale && (
              <div style={s.recOneRationale}>{defaultRec.rationale}</div>
            )}
          </div>

          {overriding ? (
            <>
              <textarea
                autoFocus
                style={s.textarea}
                rows={2}
                placeholder={question.customAnswerPlaceholder ?? 'Describe your override...'}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
              />
              <div style={s.recOneActions}>
                <button
                  style={{ ...s.overrideBtn, flex: 'none', padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => { setOverriding(false); setCustomText(''); }}
                >
                  Cancel
                </button>
                <button
                  style={{ ...s.submitBtn, flex: 1 }}
                  disabled={submitting || !customText.trim()}
                  onClick={handleSubmit}
                >
                  {justAnswered
                    ? <span style={prefersReducedMotion ? {} : s.confetti}>✓ Submitted</span>
                    : 'Submit override'}
                </button>
              </div>
            </>
          ) : (
            <div style={s.recOneActions}>
              <button style={s.acceptBtn} disabled={submitting} onClick={handleAcceptOne}>
                {justAnswered
                  ? <span style={prefersReducedMotion ? {} : s.confetti}>✓ Accepted</span>
                  : '✓ Accept'}
              </button>
              <button style={s.overrideBtn} disabled={submitting} onClick={() => setOverriding(true)}>
                Override ▾
              </button>
            </div>
          )}
        </>
      )}

      {question.state === 'open' && !isRecommendOne && (
        <>
          <ul style={s.recList}>
            {question.recommendations.map((rec) => {
              const selected = selectedRecId === rec.id && !customText.trim();
              return (
                <li
                  key={rec.id}
                  style={s.recItem(selected, !!rec.isDefault)}
                  onClick={() => { setSelectedRecId(rec.id); setCustomText(''); }}
                >
                  <input
                    type="radio"
                    style={s.radio}
                    checked={selected}
                    onChange={() => { setSelectedRecId(rec.id); setCustomText(''); }}
                  />
                  <div>
                    <div style={s.recLabel}>
                      {rec.label}
                      {rec.isDefault && <span style={s.defaultBadge}>default</span>}
                    </div>
                    <div style={s.recRationale}>{rec.rationale}</div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div style={s.divider}>— or —</div>

          <textarea
            style={s.textarea}
            rows={2}
            placeholder={question.customAnswerPlaceholder ?? 'Other / custom answer...'}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
          />

          <button style={s.submitBtn} disabled={submitting} onClick={handleSubmit}>
            {justAnswered
              ? <span style={prefersReducedMotion ? {} : s.confetti}>✓ Answer submitted</span>
              : 'Submit answer'}
          </button>
        </>
      )}

      {question.state === 'answered' && (
        <div style={s.answeredSummary}>{answerSummary(question)}</div>
      )}
    </div>
  );
}

const COLUMNS: { key: QuestionState; label: string }[] = [
  { key: 'open',      label: '❓ Open' },
  { key: 'answered',  label: '✅ Answered' },
  { key: 'cancelled', label: '⛔ Cancelled' },
];

export function QuestionsKanban() {
  const { data: questions = [] } = useSWR<Question[]>('/api/questions', fetcher, { refreshInterval: 4000 });
  const [_refresh, setRefresh] = useState(0);

  const byState = (state: QuestionState) => questions.filter((q) => q.state === state);

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
                items.map((q) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    onAnswered={() => setRefresh((n) => n + 1)}
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
