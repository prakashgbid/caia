'use client';
import { useState, useId } from 'react';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface DecompositionNode {
  id: string;
  level: 'initiative' | 'epic' | 'story' | 'task';
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  estimatedEffort?: string;
  canParallelize?: boolean;
  children?: DecompositionNode[];
  metadata?: Record<string, unknown>;
}

interface DecompositionResult {
  originalPrompt: string;
  hierarchy: DecompositionNode[];
  totalNodes: number;
  estimatedDays: number;
  recommendedParallelTracks: number;
  summary: string;
}

const LEVEL_COLOR: Record<string, string> = {
  initiative: '#9f7aea',
  epic: '#63b3ed',
  story: '#68d391',
  task: '#f6ad55',
};

const VERB_INTENT_COLOR: Record<string, string> = {
  add: '#63b3ed',
  fix: '#fc8181',
  refactor: '#68d391',
  extract: '#9f7aea',
  audit: '#f6e05e',
  spike: '#ed8936',
};

const LEVEL_BG: Record<string, string> = {
  initiative: '#1a1230',
  epic: '#0f1e30',
  story: '#0f1f18',
  task: '#1f1a0f',
};

function NodeCard({ node, depth = 0 }: { node: DecompositionNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const hasAC = (node.acceptanceCriteria?.length ?? 0) > 0;
  const color = LEVEL_COLOR[node.level] ?? '#e2e8f0';
  const bg = LEVEL_BG[node.level] ?? '#1a1f2e';

  return (
    <div
      style={{
        marginLeft: depth * 16,
        marginBottom: 6,
        border: `1px solid ${color}33`,
        borderRadius: 6,
        background: bg,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: hasChildren ? 'pointer' : 'default',
        }}
        role={hasChildren ? 'button' : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={() => hasChildren && setExpanded(e => !e)}
        onKeyDown={e => {
          if (hasChildren && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded(x => !x);
          }
        }}
      >
        {hasChildren && (
          <span aria-hidden="true" style={{ color, fontSize: 10, width: 12, flexShrink: 0 }}>
            {expanded ? '▼' : '▶'}
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            color,
            background: `${color}22`,
            padding: '1px 6px',
            borderRadius: 3,
            flexShrink: 0,
          }}
        >
          {node.level}
        </span>
        <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: depth < 2 ? 600 : 400 }}>
          {node.title}
        </span>
        {node.estimatedEffort && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#718096', flexShrink: 0 }}>
            {node.estimatedEffort}
          </span>
        )}
        {node.canParallelize && (
          <span aria-label="can parallelize" style={{ fontSize: 10, color: '#68d391', flexShrink: 0 }}>
            ∥
          </span>
        )}
      </div>

      {expanded && hasAC && (
        <div style={{ padding: '0 12px 8px' }}>
          <div style={{ fontSize: 11, color: '#718096', marginBottom: 4, fontWeight: 600 }}>
            Acceptance criteria
          </div>
          <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
            {node.acceptanceCriteria!.map((ac, i) => (
              <li key={i} style={{ fontSize: 12, color: '#a0aec0', marginBottom: 2 }}>
                {ac}
              </li>
            ))}
          </ul>
        </div>
      )}

      {expanded && hasChildren && (
        <div style={{ padding: '0 8px 8px' }}>
          {node.children!.map(child => (
            <NodeCard key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

const EXAMPLES = [
  'add a user profile page with avatar upload and a display-name field',
  'fix the login button not responsive on mobile',
  'refactor the legacy billing module into smaller services',
  'extract the JWT helpers into @chiefaia/auth-core',
  'audit the storage layer for PII handling',
  'research the best caching library for our use case',
];

export default function PlaygroundPage() {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<DecompositionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaId = useId();

  const run = async (text: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API}/decompose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DecompositionResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) void run(prompt);
  };

  const verbIntent = result?.hierarchy[0]?.metadata?.['verbIntent'] as string | undefined;

  return (
    <main
      style={{ padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 900 }}
      aria-label="Decomposer Playground"
    >
      <h1 style={{ margin: '0 0 4px', fontSize: 20, color: '#e2e8f0' }}>Decomposer Playground</h1>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: '#718096' }}>
        Submit a prompt to see how the rule-based decomposer classifies its verb intent and
        breaks it into initiatives, epics, stories, and tasks.
      </p>

      <form onSubmit={handleSubmit} aria-label="Prompt input">
        <label
          htmlFor={textareaId}
          style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#a0aec0', marginBottom: 6 }}
        >
          Prompt
        </label>
        <textarea
          id={textareaId}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder='e.g. "add a user profile page with avatar upload"'
          rows={4}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontSize: 13,
            fontFamily: 'inherit',
            padding: '10px 12px',
            borderRadius: 6,
            border: '1px solid #2d3748',
            background: '#141820',
            color: '#e2e8f0',
            resize: 'vertical',
            outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#63b3ed'; }}
          onBlur={e => { e.currentTarget.style.borderColor = '#2d3748'; }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            aria-busy={loading}
            style={{
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: 600,
              background: loading || !prompt.trim() ? '#2d3748' : '#3182ce',
              color: loading || !prompt.trim() ? '#718096' : '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Decomposing…' : 'Decompose'}
          </button>
          <span style={{ fontSize: 12, color: '#4a5568' }}>or try an example:</span>
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setPrompt(ex);
                void run(ex);
              }}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                background: '#1a1f2e',
                color: '#63b3ed',
                border: '1px solid #2d3748',
                borderRadius: 4,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {ex.split(' ').slice(0, 3).join(' ')}…
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 16,
            padding: '10px 14px',
            background: '#2d1a1a',
            border: '1px solid #fc8181',
            borderRadius: 6,
            color: '#fc8181',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <section aria-label="Decomposition result" style={{ marginTop: 24 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}
          >
            <h2 style={{ margin: 0, fontSize: 15, color: '#e2e8f0' }}>Result</h2>
            {verbIntent && (
              <span
                data-test-region="verb-intent"
                data-verb-intent={verbIntent}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  background: `${VERB_INTENT_COLOR[verbIntent] ?? '#9f7aea'}33`,
                  color: VERB_INTENT_COLOR[verbIntent] ?? '#9f7aea',
                  padding: '2px 8px',
                  borderRadius: 3,
                }}
              >
                verb: {verbIntent}
              </span>
            )}
            <span style={{ fontSize: 12, color: '#718096' }}>
              {result.totalNodes} nodes · ~{result.estimatedDays}d · {result.recommendedParallelTracks} track(s)
            </span>
          </div>

          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#a0aec0', fontStyle: 'italic' }}>
            {result.summary}
          </p>

          <div role="tree" aria-label="Decomposition hierarchy">
            {result.hierarchy.map(node => (
              <NodeCard key={node.id} node={node} depth={0} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
