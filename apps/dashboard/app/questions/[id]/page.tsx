'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Question {
  id: string;
  title: string;
  context: string;
  state: string;
  priority: string;
  recommendations: string;
  customAnswerPlaceholder?: string | null;
  answer?: string | null;
  answeredAt?: string | null;
  requirementId?: string | null;
  taskId?: string | null;
  projectId?: string | null;
  scope: string;
  createdAt: string;
}

export default function QuestionDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/questions')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const found = (data as Question[]).find(q => q.id === id);
          setQuestion(found ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading...</div>;
  if (!question) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>Question not found</div>
      <Link href="/questions" style={{ color: '#63b3ed', textDecoration: 'none' }}>← Back</Link>
    </div>
  );

  const recommendations = (() => { try { return JSON.parse(question.recommendations) as string[]; } catch { return []; } })();

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
        <Link href="/questions" style={{ color: '#63b3ed', textDecoration: 'none' }}>Questions</Link>
        {' / '}
        <span style={{ color: '#a0aec0' }}>{id.slice(0, 12)}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#f0f4f8', flex: 1 }}>{question.title}</h1>
        <span style={{
          fontSize: 11,
          background: question.state === 'open' ? '#2a4365' : '#276749',
          color: question.state === 'open' ? '#bee3f8' : '#9ae6b4',
          padding: '3px 8px', borderRadius: 10
        }}>
          {question.state}
        </span>
      </div>

      {question.context && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Context</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '12px 14px', border: '1px solid #2d3748', fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
            {question.context}
          </div>
        </div>
      )}

      {recommendations.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 6 }}>Recommendations</div>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '10px 14px', border: '1px solid #2d3748' }}>
            {recommendations.map((r, i) => (
              <div key={i} style={{ fontSize: 13, color: '#a0aec0', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #4a5568' }}>{r}</div>
            ))}
          </div>
        </div>
      )}

      {question.answer && (
        <div style={{ background: '#1c4532', borderRadius: 6, padding: '12px 14px', border: '1px solid #276749', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#9ae6b4', marginBottom: 6 }}>
            Answer {question.answeredAt ? `(${new Date(question.answeredAt).toLocaleString()})` : ''}
          </div>
          <div style={{ fontSize: 13, color: '#e2e8f0' }}>{question.answer}</div>
        </div>
      )}
    </div>
  );
}
