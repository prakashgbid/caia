'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  slug: string;
  status: string;
  color?: string | null;
  icon?: string | null;
}

interface SubmitResponse {
  prompt_id?: string;
  correlation_id?: string;
  error?: string;
}

// ─── Inline classifier ────────────────────────────────────────────────────────
// Lightweight client-side classification — no network call needed.

const REQUEST_TYPES = [
  {
    id: 'new-project',
    label: 'New Project',
    emoji: '🟦',
    color: '#63b3ed',
    bg: '#1a2744',
    keywords: ['new project', 'create project', 'start project', 'build a new', 'from scratch', 'greenfield'],
  },
  {
    id: 'new-feature',
    label: 'New Feature',
    emoji: '🟦',
    color: '#9f7aea',
    bg: '#2d1f4a',
    keywords: ['add', 'implement', 'feature', 'create', 'build', 'integrate', 'support', 'allow', 'enable'],
  },
  {
    id: 'bug-fix',
    label: 'Bug Fix',
    emoji: '🔴',
    color: '#fc8181',
    bg: '#3d1515',
    keywords: ['fix', 'bug', 'broken', 'issue', 'error', 'not working', 'failing', 'wrong', 'incorrect', 'crash', 'regression'],
  },
  {
    id: 'refactor',
    label: 'Refactor',
    emoji: '🔵',
    color: '#68d391',
    bg: '#1a3320',
    keywords: ['refactor', 'restructure', 'clean up', 'rewrite', 'reorganize', 'simplify', 'extract', 'move'],
  },
  {
    id: 'performance',
    label: 'Performance',
    emoji: '⚡',
    color: '#f6ad55',
    bg: '#3d2a00',
    keywords: ['performance', 'speed', 'optimize', 'slow', 'faster', 'latency', 'throughput', 'cache', 'efficient'],
  },
  {
    id: 'security',
    label: 'Security',
    emoji: '🔒',
    color: '#fc8181',
    bg: '#3d1515',
    keywords: ['security', 'auth', 'permission', 'vulnerability', 'exploit', 'xss', 'csrf', 'injection', 'encrypt', 'token'],
  },
  {
    id: 'content',
    label: 'Content / Docs',
    emoji: '📝',
    color: '#a0aec0',
    bg: '#2d3748',
    keywords: ['documentation', 'docs', 'content', 'copy', 'text', 'readme', 'changelog', 'write'],
  },
] as const;

const DOMAIN_PATTERNS: Array<{ name: string; keywords: string[] }> = [
  { name: 'Authentication & Authorization',  keywords: ['auth', 'login', 'oauth', 'jwt', 'session', 'permission', 'role', 'user', 'sign in', 'sign up'] },
  { name: 'Data & Storage',                  keywords: ['database', 'db', 'schema', 'sql', 'migration', 'storage', 'redis', 'cache', 'file', 'upload', 's3'] },
  { name: 'API & Integrations',              keywords: ['api', 'endpoint', 'rest', 'graphql', 'webhook', 'integration', 'third-party', 'fetch', 'request'] },
  { name: 'UI & Frontend',                   keywords: ['ui', 'frontend', 'component', 'page', 'design', 'css', 'style', 'layout', 'react', 'modal', 'form', 'button'] },
  { name: 'DevOps & Infrastructure',         keywords: ['deploy', 'ci', 'cd', 'docker', 'kubernetes', 'cloud', 'server', 'infra', 'pipeline', 'build', 'scale'] },
  { name: 'Testing & Quality',               keywords: ['test', 'testing', 'coverage', 'unit test', 'e2e', 'playwright', 'jest', 'quality', 'qa'] },
  { name: 'Performance & Optimization',      keywords: ['performance', 'speed', 'optimize', 'cache', 'slow', 'latency', 'profil'] },
  { name: 'Security',                        keywords: ['security', 'vulnerability', 'encrypt', 'xss', 'injection', 'audit'] },
  { name: 'Analytics & Reporting',           keywords: ['analytics', 'metrics', 'report', 'dashboard', 'chart', 'track', 'event', 'insight'] },
];

function classifyText(text: string): {
  requestType: typeof REQUEST_TYPES[number] | null;
  domain: string | null;
} {
  if (text.length < 8) return { requestType: null, domain: null };

  const lower = text.toLowerCase();

  // Detect request type (score-based)
  let bestType: typeof REQUEST_TYPES[number] = REQUEST_TYPES[1]; // default: new-feature
  let bestScore = 0;
  for (const type of REQUEST_TYPES) {
    const score = type.keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; bestType = type; }
  }
  const requestType = bestScore > 0 ? bestType : REQUEST_TYPES[1];

  // Detect domain
  let bestDomain: string | null = null;
  let bestDomainScore = 0;
  for (const d of DOMAIN_PATTERNS) {
    const score = d.keywords.filter(k => lower.includes(k)).length;
    if (score > bestDomainScore) { bestDomainScore = score; bestDomain = d.name; }
  }

  return { requestType, domain: bestDomainScore > 0 ? bestDomain : null };
}

// ─── Agent team tiers ─────────────────────────────────────────────────────────

interface AgentTier {
  tier: string;
  agents: Array<{ name: string; abbr: string; color: string }>;
}

const AGENT_TIERS: AgentTier[] = [
  {
    tier: 'Strategic',
    agents: [
      { name: 'Enterprise Architect', abbr: 'EA', color: '#63b3ed' },
      { name: 'Product Owner', abbr: 'PO', color: '#9f7aea' },
    ],
  },
  {
    tier: 'Planning',
    agents: [
      { name: 'Business Analyst', abbr: 'BA', color: '#f6ad55' },
      { name: 'UX Researcher', abbr: 'UX', color: '#fc8181' },
      { name: 'Sprint Scheduler', abbr: 'SS', color: '#68d391' },
    ],
  },
  {
    tier: 'Engineering',
    agents: [
      { name: 'Lead Developer', abbr: 'LD', color: '#4299e1' },
      { name: 'Backend Engineer', abbr: 'BE', color: '#38b2ac' },
      { name: 'Frontend Engineer', abbr: 'FE', color: '#667eea' },
    ],
  },
  {
    tier: 'Quality',
    agents: [
      { name: 'QA Engineer', abbr: 'QA', color: '#48bb78' },
      { name: 'Security Reviewer', abbr: 'SR', color: '#fc8181' },
    ],
  },
];

function getActiveAgents(requestType: string | null): Set<string> {
  const active = new Set<string>(['EA', 'PO']); // always active

  if (!requestType || requestType === 'content') return active;

  if (requestType === 'new-project') {
    return new Set(['EA', 'PO', 'BA', 'UX', 'SS', 'LD', 'BE', 'FE', 'QA', 'SR']);
  }
  if (requestType === 'new-feature') {
    return new Set(['EA', 'PO', 'BA', 'UX', 'SS', 'LD', 'BE', 'FE', 'QA']);
  }
  if (requestType === 'bug-fix') {
    return new Set(['EA', 'PO', 'BE', 'FE', 'QA']);
  }
  if (requestType === 'refactor') {
    return new Set(['EA', 'PO', 'BA', 'LD', 'BE', 'FE', 'QA']);
  }
  if (requestType === 'performance') {
    return new Set(['EA', 'PO', 'LD', 'BE', 'QA']);
  }
  if (requestType === 'security') {
    return new Set(['EA', 'PO', 'LD', 'BE', 'QA', 'SR']);
  }

  return active;
}

// ─── Progress panel ───────────────────────────────────────────────────────────

const AGENT_STEPS = [
  { delay: 0,    label: '🔵 Scaffolder',         msg: 'assembling your AI team...' },
  { delay: 1200, label: '🟣 PO Agent',            msg: 'decomposing requirements...' },
  { delay: 2500, label: '🟡 Business Analyst',    msg: 'mapping acceptance criteria...' },
  { delay: 3800, label: '🏗️ Enterprise Architect', msg: 'designing system architecture...' },
  { delay: 5200, label: '📋 Sprint Scheduler',    msg: 'planning story & task breakdown...' },
];

function ProgressPanel({ promptId }: { promptId: string }) {
  const router = useRouter();
  const [visibleSteps, setVisibleSteps] = useState<number[]>([]);
  const [showLink, setShowLink] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    AGENT_STEPS.forEach((step, i) => {
      timers.push(setTimeout(() => {
        setVisibleSteps(prev => [...prev, i]);
      }, step.delay));
    });

    timers.push(setTimeout(() => setShowLink(true), 3000));

    // Auto-redirect after 5s
    const redirectTimer = setTimeout(() => {
      router.push(`/pipeline?promptId=${promptId}`);
    }, 5000);

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(redirectTimer);
    };
  }, [promptId, router]);

  return (
    <div
      style={{
        marginTop: 24,
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderLeft: '4px solid #68d391',
        borderRadius: 10,
        padding: '18px 20px',
        animation: 'fadeSlideIn 0.3s ease',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: '#68d391', marginBottom: 14 }}>
        ✅ Submitted — Your AI team is assembling
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {AGENT_STEPS.map((step, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: visibleSteps.includes(i) ? 1 : 0.25,
              transition: 'opacity 0.4s ease',
              fontSize: 13,
              color: '#e2e8f0',
            }}
          >
            <span style={{ fontWeight: 600, minWidth: 160 }}>{step.label}</span>
            <span style={{ color: '#718096' }}>— {step.msg}</span>
            {visibleSteps.includes(i) && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#68d391',
                  flexShrink: 0,
                  animation: 'pulseGreen 1.5s infinite',
                }}
              />
            )}
          </div>
        ))}
      </div>

      {showLink && (
        <div style={{ marginTop: 16, borderTop: '1px solid #2d3748', paddingTop: 14 }}>
          <Link
            href={`/pipeline?promptId=${promptId}`}
            style={{
              color: '#90cdf4',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            View full pipeline →
          </Link>
          <span style={{ fontSize: 12, color: '#4a5568', marginLeft: 12 }}>
            (auto-redirecting in a moment…)
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Priority slider ──────────────────────────────────────────────────────────

const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
type Priority = typeof PRIORITIES[number];

const PRIORITY_STYLE: Record<Priority, { color: string; label: string }> = {
  low:      { color: '#718096', label: '🔵 Low' },
  normal:   { color: '#63b3ed', label: '⚪ Normal' },
  high:     { color: '#f6ad55', label: '🟡 High' },
  critical: { color: '#fc8181', label: '🔴 Critical' },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SubmitPage() {
  const router = useRouter();

  // Form state
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [skipDecomposition, setSkipDecomposition] = useState(false);
  const [notifyOnComplete, setNotifyOnComplete] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [promptId, setPromptId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Data
  const [projects, setProjects] = useState<Project[]>([]);
  const [classification, setClassification] = useState<ReturnType<typeof classifyText> | null>(null);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load projects
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setProjects(data as Project[]);
      })
      .catch(() => {});
  }, []);

  // Auto-grow textarea
  const growTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(Math.max(el.scrollHeight, 200), 400) + 'px';
  }, []);

  // Debounced classification
  const handleTextChange = useCallback((val: string) => {
    setText(val);
    growTextarea();

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setClassification(val.length >= 8 ? classifyText(val) : null);
    }, 500);
  }, [growTextarea]);

  // Cmd/Ctrl+Enter to submit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !submitting && !submitted && text.trim()) {
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleSubmit = useCallback(async () => {
    if (!text.trim() || submitting || submitted) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          projectId: projectId || undefined,
          priority,
          source: 'dashboard',
          skipDecomposition,
        }),
      });

      const data = await res.json() as SubmitResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? 'Submission failed');

      setPromptId(data.prompt_id ?? null);
      setSubmitted(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [text, projectId, priority, skipDecomposition, submitting, submitted]);

  const activeAgents = getActiveAgents(classification?.requestType?.id ?? null);
  const activeProjects = projects.filter(p => p.status === 'active');

  return (
    <>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseGreen {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .submit-btn:hover:not(:disabled) {
          background: #2a4a7f !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(66,153,225,0.3);
        }
        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .toggle-track {
          transition: background 0.2s;
        }
        select:focus, textarea:focus {
          outline: none;
        }
      `}</style>

      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          padding: '8px 0 48px',
        }}
      >
        {/* ── Header ────────────────────────────────────── */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✦</div>
          <h1
            style={{
              margin: '0 0 6px',
              fontSize: 26,
              fontWeight: 700,
              color: '#f0f4f8',
              letterSpacing: '-0.02em',
            }}
          >
            Chief AI Agent
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: '#718096', lineHeight: 1.5 }}>
            Submit a requirement, feature, or idea — your AI team will handle the rest.
          </p>
        </div>

        {/* ── Main form card ─────────────────────────────── */}
        <div
          style={{
            background: '#1a1f2e',
            border: '1px solid #2d3748',
            borderRadius: 12,
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {/* Project selector */}
          {activeProjects.length > 0 && (
            <div>
              <label
                htmlFor="project-select"
                style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#a0aec0', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                Project (optional)
              </label>
              <select
                id="project-select"
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                disabled={submitted}
                style={{
                  width: '100%',
                  background: '#111520',
                  color: '#e2e8f0',
                  border: '1px solid #2d3748',
                  borderRadius: 7,
                  padding: '9px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23718096' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  paddingRight: 32,
                }}
                onFocus={e => { e.target.style.borderColor = '#4299e1'; }}
                onBlur={e => { e.target.style.borderColor = '#2d3748'; }}
              >
                <option value="">No project (global)</option>
                {activeProjects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.icon ? `${p.icon} ` : ''}{p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Text area */}
          <div>
            <label
              htmlFor="prompt-text"
              style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#a0aec0', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              Requirement / Idea
            </label>
            <div style={{ position: 'relative' }}>
              <textarea
                id="prompt-text"
                ref={textareaRef}
                value={text}
                onChange={e => handleTextChange(e.target.value)}
                placeholder="Describe what you want to build. Be as detailed or as brief as you like — your AI team will ask clarifying questions if needed."
                disabled={submitted}
                style={{
                  width: '100%',
                  minHeight: 200,
                  height: 200,
                  maxHeight: 400,
                  background: '#111520',
                  border: '1px solid #2d3748',
                  borderRadius: 8,
                  color: '#e2e8f0',
                  fontSize: 14,
                  lineHeight: 1.7,
                  padding: '14px 16px',
                  resize: 'none',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = '#4299e1'; }}
                onBlur={e => { e.target.style.borderColor = '#2d3748'; }}
              />
              {/* Character count */}
              <span
                style={{
                  position: 'absolute',
                  bottom: 10,
                  right: 12,
                  fontSize: 11,
                  color: text.length > 3000 ? '#fc8181' : '#4a5568',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {text.length.toLocaleString()} characters
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#4a5568', marginTop: 4, textAlign: 'right' }}>
              Tip: Cmd+Enter to submit
            </div>
          </div>

          {/* Classification badge */}
          {classification && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', animation: 'fadeSlideIn 0.25s ease' }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: classification.requestType?.color ?? '#a0aec0',
                  background: (classification.requestType?.bg ?? '#2d3748'),
                  border: `1px solid ${(classification.requestType?.color ?? '#718096')}44`,
                  borderRadius: 10,
                  padding: '3px 10px',
                }}
              >
                {classification.requestType?.emoji} {classification.requestType?.label ?? 'Unknown'}
              </span>
              {classification.domain && (
                <span style={{ fontSize: 12, color: '#718096' }}>
                  Domain: <span style={{ color: '#a0aec0', fontWeight: 500 }}>{classification.domain}</span>
                </span>
              )}
            </div>
          )}

          {/* Agent team preview */}
          {text.length >= 20 && (
            <div style={{ animation: 'fadeSlideIn 0.3s ease' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#a0aec0', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Agent Team
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {AGENT_TIERS.map(tier => (
                  <div key={tier.tier} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#4a5568', minWidth: 80, fontWeight: 500 }}>
                      {tier.tier}
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {tier.agents.map(agent => {
                        const isActive = activeAgents.has(agent.abbr);
                        return (
                          <span
                            key={agent.abbr}
                            title={agent.name}
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: isActive ? agent.color : '#4a5568',
                              background: isActive ? agent.color + '1a' : '#1a1f2e',
                              border: `1px solid ${isActive ? agent.color + '44' : '#2d3748'}`,
                              borderRadius: 6,
                              padding: '3px 8px',
                              transition: 'all 0.2s',
                              opacity: isActive ? 1 : 0.4,
                            }}
                          >
                            {agent.abbr}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Advanced options */}
          <div>
            <button
              onClick={() => setShowAdvanced(v => !v)}
              style={{
                background: 'none',
                border: 'none',
                color: '#718096',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: 0,
              }}
            >
              <span style={{ transition: 'transform 0.2s', transform: showAdvanced ? 'rotate(90deg)' : 'none' }}>▸</span>
              Advanced options
            </button>

            {showAdvanced && (
              <div
                style={{
                  marginTop: 14,
                  padding: '16px',
                  background: '#111520',
                  border: '1px solid #2d3748',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                  animation: 'fadeSlideIn 0.2s ease',
                }}
              >
                {/* Priority slider */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#a0aec0', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Priority — <span style={{ color: PRIORITY_STYLE[priority].color }}>{PRIORITY_STYLE[priority].label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {PRIORITIES.map(p => (
                      <button
                        key={p}
                        onClick={() => setPriority(p)}
                        style={{
                          flex: 1,
                          padding: '6px 0',
                          borderRadius: 6,
                          border: `1px solid ${priority === p ? PRIORITY_STYLE[p].color + '88' : '#2d3748'}`,
                          background: priority === p ? PRIORITY_STYLE[p].color + '22' : '#1a1f2e',
                          color: priority === p ? PRIORITY_STYLE[p].color : '#718096',
                          fontSize: 12,
                          fontWeight: priority === p ? 700 : 400,
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          textTransform: 'capitalize',
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Skip decomposition toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>
                      Skip AI decomposition
                    </div>
                    <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
                      Create a single task directly instead of decomposing into requirements and stories
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={skipDecomposition}
                    onClick={() => setSkipDecomposition(v => !v)}
                    className="toggle-track"
                    style={{
                      width: 40,
                      height: 22,
                      borderRadius: 11,
                      border: 'none',
                      background: skipDecomposition ? '#4299e1' : '#2d3748',
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      marginLeft: 16,
                      transition: 'background 0.2s',
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: '#f0f4f8',
                        display: 'block',
                        transform: skipDecomposition ? 'translateX(18px)' : 'translateX(0)',
                        transition: 'transform 0.2s',
                      }}
                    />
                  </button>
                </div>

                {/* Notify toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>
                      Notify me on completion
                    </div>
                    <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
                      Coming soon — send a notification when this prompt is fully processed
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={notifyOnComplete}
                    onClick={() => setNotifyOnComplete(v => !v)}
                    disabled
                    className="toggle-track"
                    style={{
                      width: 40,
                      height: 22,
                      borderRadius: 11,
                      border: 'none',
                      background: '#2d3748',
                      cursor: 'not-allowed',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      marginLeft: 16,
                      opacity: 0.4,
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: '#f0f4f8',
                        display: 'block',
                        transform: 'translateX(0)',
                      }}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {errorMsg && (
            <div
              style={{
                padding: '10px 14px',
                background: '#3d1515',
                border: '1px solid #742a2a',
                borderRadius: 7,
                color: '#fc8181',
                fontSize: 13,
              }}
              role="alert"
            >
              ❌ {errorMsg}
            </div>
          )}

          {/* Submit button */}
          {!submitted && (
            <button
              className="submit-btn"
              onClick={() => void handleSubmit()}
              disabled={submitting || !text.trim() || submitted}
              style={{
                width: '100%',
                padding: '14px 24px',
                background: text.trim() ? '#1a3a7f' : '#2d3748',
                color: text.trim() ? '#90cdf4' : '#4a5568',
                border: `1px solid ${text.trim() ? '#2a5aaf' : '#2d3748'}`,
                borderRadius: 9,
                fontSize: 15,
                fontWeight: 700,
                cursor: text.trim() && !submitting ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                letterSpacing: '-0.01em',
              }}
              aria-label="Submit to your AI team"
            >
              {submitting ? (
                <>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      border: '2px solid #4299e144',
                      borderTop: '2px solid #63b3ed',
                      borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  Submitting to your AI team…
                </>
              ) : (
                'Submit to your AI team →'
              )}
            </button>
          )}
        </div>

        {/* ── Success: progress panel ─────────────────────── */}
        {submitted && promptId && (
          <ProgressPanel promptId={promptId} />
        )}
      </div>
    </>
  );
}
