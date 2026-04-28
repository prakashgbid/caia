'use client';
import { useEffect, useState, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface Domain {
  slug: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  parentSlug?: string | null;
}

interface Counts {
  requirement: number;
  blocker: number;
  question: number;
  adr: number;
  feature: number;
  suggestion: number;
  timeline: number;
}

interface DomainDetail {
  domain: Domain;
  counts: Counts;
  projectBreakdown: Record<string, number>;
  entities: {
    requirements: Array<{ id: string; title: string; state: string; projectId?: string | null }>;
    blockers: Array<{ id: string; title: string; state: string; projectId?: string | null }>;
    questions: Array<{ id: string; title: string; state: string; projectId?: string | null }>;
    adrs: Array<{ id: string; title: string; status: string; number: number; projectId?: string | null }>;
    features: Array<{ id: string; title: string; status: string; projectId?: string | null }>;
    suggestions: Array<{ id: string; title: string; state: string; projectId?: string | null }>;
    timeline: Array<{ id: string; kind: string; summary: string; createdAt: string; projectId?: string | null }>;
  };
}

const STATE_COLORS: Record<string, string> = {
  open: '#fc8181',
  captured: '#63b3ed',
  executing: '#68d391',
  done: '#9ae6b4',
  ready: '#f6ad55',
  cancelled: '#718096',
  resolved: '#68d391',
  answered: '#68d391',
  proposed: '#b794f4',
  accepted: '#68d391',
  planned: '#63b3ed',
};

function StateTag({ state }: { state: string }) {
  const color = STATE_COLORS[state] ?? '#718096';
  return (
    <span style={{
      fontSize: 10,
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      borderRadius: 8,
      padding: '1px 6px',
    }}>{state}</span>
  );
}

function SectionTable({ title, rows, href, color }: {
  title: string;
  rows: Array<{ id: string; label: string; state: string; extra?: string }>;
  href: (id: string) => string;
  color: string;
}) {
  if (!rows.length) return null;
  return (
    <section aria-labelledby={`section-${title}`} style={{ marginBottom: 24 }}>
      <h2
        id={`section-${title}`}
        style={{ fontSize: 15, fontWeight: 600, color, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        {title}
        <span style={{ fontSize: 12, color: '#718096', fontWeight: 400 }}>({rows.length})</span>
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map(row => (
          <Link
            key={row.id}
            href={href(row.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: '#1a1f2e',
              borderRadius: 4,
              borderLeft: `3px solid ${color}`,
              textDecoration: 'none',
              color: '#e2e8f0',
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.extra ? <span style={{ color: '#718096', marginRight: 6, fontFamily: 'monospace', fontSize: 11 }}>{row.extra}</span> : null}
              {row.label}
            </span>
            <StateTag state={row.state} />
          </Link>
        ))}
      </div>
    </section>
  );
}

function DomainDetailContent() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const project = searchParams.get('project') ?? '';
  const [detail, setDetail] = useState<DomainDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = project ? `?project=${project}` : '';
    fetch(`/api/domains/${params.slug}${qs}`)
      .then(r => r.ok ? r.json() : Promise.reject('Not found'))
      .then((data: DomainDetail) => setDetail(data))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, [params.slug, project]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading domain...</div>;
  if (error || !detail) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: '#fc8181', marginBottom: 12 }}>Domain not found.</div>
        <Link href="/domains" style={{ color: '#63b3ed' }}>← Back to domains</Link>
      </div>
    );
  }

  const { domain, counts, projectBreakdown, entities } = detail;
  const totalEntities = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16, fontSize: 13, color: '#718096' }}>
        <Link href="/domains" style={{ color: '#63b3ed', textDecoration: 'none' }}>Domains</Link>
        <span style={{ margin: '0 6px' }}>›</span>
        <span>{domain.name}</span>
      </div>

      {/* Header */}
      <div
        style={{
          background: '#1a1f2e',
          border: `1px solid ${domain.color}44`,
          borderLeft: `4px solid ${domain.color}`,
          borderRadius: 8,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 32 }} aria-hidden="true">{domain.icon}</span>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
              {domain.name}
            </h1>
            <div style={{ fontSize: 12, color: '#718096', fontFamily: 'monospace', marginBottom: 6 }}>{domain.slug}</div>
            {domain.description && (
              <div style={{ fontSize: 14, color: '#a0aec0', lineHeight: 1.5 }}>{domain.description}</div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: domain.color }}>{totalEntities}</div>
            <div style={{ fontSize: 11, color: '#718096' }}>total entities</div>
          </div>
        </div>

        {/* Count pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }} aria-label="Entity type breakdown">
          {([
            { key: 'requirement', label: 'Requirements', color: '#2196F3' },
            { key: 'blocker', label: 'Blockers', color: '#f44336' },
            { key: 'question', label: 'Questions', color: '#FF9800' },
            { key: 'adr', label: 'ADRs', color: '#9C27B0' },
            { key: 'feature', label: 'Features', color: '#00BCD4' },
            { key: 'suggestion', label: 'Suggestions', color: '#FF5722' },
            { key: 'timeline', label: 'Timeline', color: '#607D8B' },
          ] as const).map(({ key, label, color }) => {
            const n = counts[key as keyof Counts] ?? 0;
            if (!n) return null;
            return (
              <span
                key={key}
                style={{
                  fontSize: 12,
                  background: color + '22',
                  color,
                  border: `1px solid ${color}44`,
                  borderRadius: 10,
                  padding: '3px 9px',
                  fontWeight: 500,
                }}
                aria-label={`${n} ${label}`}
              >
                {label}: {n}
              </span>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 24, alignItems: 'start' }}>
        {/* Main content */}
        <div>
          {/* Project filter */}
          {project && (
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#a0aec0' }}>Filtered by project:</span>
              <code style={{ fontSize: 12, background: '#2d3748', padding: '2px 6px', borderRadius: 4, color: '#90cdf4' }}>{project}</code>
              <button
                onClick={() => router.push(`/domains/${domain.slug}`)}
                style={{ background: 'none', border: 'none', color: '#fc8181', cursor: 'pointer', fontSize: 12 }}
                aria-label="Clear project filter"
              >
                ×
              </button>
            </div>
          )}

          <SectionTable
            title="Requirements"
            rows={entities.requirements.map(r => ({ id: r.id, label: r.title, state: r.state }))}
            href={id => `/requirements/${id}`}
            color="#2196F3"
          />
          <SectionTable
            title="Blockers"
            rows={entities.blockers.map(r => ({ id: r.id, label: r.title, state: r.state }))}
            href={id => `/blockers/${id}`}
            color="#f44336"
          />
          <SectionTable
            title="Questions"
            rows={entities.questions.map(r => ({ id: r.id, label: r.title, state: r.state }))}
            href={id => `/questions/${id}`}
            color="#FF9800"
          />
          <SectionTable
            title="ADRs"
            rows={entities.adrs.map(r => ({ id: r.id, label: r.title, state: r.status, extra: `ADR-${r.number}` }))}
            href={id => `/adrs/${id}`}
            color="#9C27B0"
          />
          <SectionTable
            title="Features"
            rows={entities.features.map(r => ({ id: r.id, label: r.title, state: r.status }))}
            href={id => `/features/${id}`}
            color="#00BCD4"
          />
          <SectionTable
            title="Suggestions"
            rows={entities.suggestions.map(r => ({ id: r.id, label: r.title, state: r.state }))}
            href={id => `/suggestions/${id}`}
            color="#FF5722"
          />

          {/* Timeline section */}
          {entities.timeline.length > 0 && (
            <section aria-labelledby="section-timeline" style={{ marginBottom: 24 }}>
              <h2
                id="section-timeline"
                style={{ fontSize: 15, fontWeight: 600, color: '#607D8B', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                Timeline
                <span style={{ fontSize: 12, color: '#718096', fontWeight: 400 }}>({entities.timeline.length})</span>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {entities.timeline.map(ev => (
                  <div
                    key={ev.id}
                    style={{
                      padding: '6px 10px',
                      background: '#1a1f2e',
                      borderRadius: 4,
                      borderLeft: '3px solid #607D8B',
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <code style={{ fontSize: 11, color: '#607D8B', whiteSpace: 'nowrap' }}>{ev.kind}</code>
                    <span style={{ fontSize: 13, color: '#a0aec0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.summary || ev.kind}
                    </span>
                    <time
                      dateTime={ev.createdAt}
                      style={{ fontSize: 11, color: '#718096', whiteSpace: 'nowrap' }}
                    >
                      {new Date(ev.createdAt).toLocaleDateString()}
                    </time>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar: project breakdown */}
        <aside aria-label="Project breakdown">
          <div style={{ background: '#1a1f2e', borderRadius: 8, border: '1px solid #2d3748', padding: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              By Project
            </h3>
            {Object.keys(projectBreakdown).length === 0 ? (
              <div style={{ color: '#718096', fontSize: 12 }}>No project data</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(projectBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([proj, count]) => {
                    const maxCount = Math.max(...Object.values(projectBreakdown));
                    const pct = Math.round((count / maxCount) * 100);
                    return (
                      <div key={proj}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <button
                            onClick={() => router.push(`/domains/${domain.slug}?project=${proj}`)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: proj === 'global' ? '#718096' : '#63b3ed',
                              cursor: proj === 'global' ? 'default' : 'pointer',
                              fontSize: 12,
                              padding: 0,
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: 160,
                            }}
                            aria-label={`Filter by project ${proj}`}
                          >
                            {proj}
                          </button>
                          <span style={{ fontSize: 12, color: '#a0aec0' }}>{count}</span>
                        </div>
                        <div style={{ height: 4, background: '#2d3748', borderRadius: 2 }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: domain.color,
                              borderRadius: 2,
                            }}
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Deep link to timeline filtered */}
          <div style={{ marginTop: 12 }}>
            <Link
              href={`/timeline?domain=${domain.slug}`}
              style={{
                display: 'block',
                textAlign: 'center',
                background: '#2d3748',
                color: '#a0aec0',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 13,
                textDecoration: 'none',
                border: '1px solid #4a5568',
              }}
              aria-label={`View timeline filtered to ${domain.name} domain`}
            >
              🕒 Timeline for this domain
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function DomainDetailPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading domain...</div>}>
      <DomainDetailContent />
    </Suspense>
  );
}
