'use client';
import { useState, useMemo, Suspense } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnforcementRule {
  rule_id: string;
  memory_file: string;
  rule_text: string;
  current_enforcement: string;
  proposed_mechanism: string;
  is_advisory: boolean;
  enforcement_status: 'enforced' | 'gap' | 'advisory';
  last_violated_at?: string;
  violation_count_7d: number;
  violation_count_30d: number;
}

interface EnforcementStats {
  total_rules: number;
  mechanically_enforced: number;
  advisory: number;
  gap_count: number;
  violations_7d: number;
  violations_30d: number;
  by_mechanism: Record<string, number>;
  most_violated: EnforcementRule[];
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_RULES: EnforcementRule[] = [
  {
    rule_id: 'TRACE-001',
    memory_file: 'prompt_traceability.md',
    rule_text: 'prompt_create must be called first before any task execution',
    current_enforcement: 'none',
    proposed_mechanism: 'runtime-middleware',
    is_advisory: false,
    enforcement_status: 'gap',
    last_violated_at: '2026-04-21T14:32:00Z',
    violation_count_7d: 12,
    violation_count_30d: 38,
  },
  {
    rule_id: 'TASK-001',
    memory_file: 'task_execution.md',
    rule_text: 'task_run_record must be written after every task spawn',
    current_enforcement: 'none',
    proposed_mechanism: 'runtime-middleware',
    is_advisory: false,
    enforcement_status: 'gap',
    last_violated_at: '2026-04-22T08:15:00Z',
    violation_count_7d: 7,
    violation_count_30d: 21,
  },
  {
    rule_id: 'AUTON-001',
    memory_file: 'autonomy_rules.md',
    rule_text: 'Never ask "path-forward" clarification questions — act autonomously',
    current_enforcement: 'none',
    proposed_mechanism: 'runtime-middleware',
    is_advisory: false,
    enforcement_status: 'gap',
    last_violated_at: '2026-04-20T11:05:00Z',
    violation_count_7d: 3,
    violation_count_30d: 9,
  },
  {
    rule_id: 'HEALTH-009',
    memory_file: 'health_invariants.md',
    rule_text: 'Zero tasks with null root_prompt_id are permitted in the database',
    current_enforcement: 'none',
    proposed_mechanism: 'db-constraint',
    is_advisory: false,
    enforcement_status: 'gap',
    last_violated_at: '2026-04-19T22:44:00Z',
    violation_count_7d: 2,
    violation_count_30d: 5,
  },
  {
    rule_id: 'SEC-005',
    memory_file: 'secrets_security.md',
    rule_text: 'gitleaks + trufflehog must run on every commit',
    current_enforcement: 'gate:pre-commit-hook',
    proposed_mechanism: 'pre-commit-hook',
    is_advisory: false,
    enforcement_status: 'enforced',
    violation_count_7d: 0,
    violation_count_30d: 0,
  },
  {
    rule_id: 'ENFORCE-001',
    memory_file: 'enforcement_coverage.md',
    rule_text: 'Every exported function must emit an event',
    current_enforcement: 'gate:build-runner',
    proposed_mechanism: 'build-runner-gate',
    is_advisory: false,
    enforcement_status: 'enforced',
    violation_count_7d: 0,
    violation_count_30d: 1,
  },
  {
    rule_id: 'ENFORCE-007',
    memory_file: 'enforcement_coverage.md',
    rule_text: '100% coverage delta — new code must not reduce overall coverage',
    current_enforcement: 'gate:build-runner',
    proposed_mechanism: 'build-runner-gate',
    is_advisory: false,
    enforcement_status: 'enforced',
    violation_count_7d: 0,
    violation_count_30d: 0,
  },
  {
    rule_id: 'SEC-050',
    memory_file: 'secrets_security.md',
    rule_text: 'gate:supply-chain must be present in build-runner pipeline',
    current_enforcement: 'none',
    proposed_mechanism: 'build-runner-gate',
    is_advisory: false,
    enforcement_status: 'gap',
    violation_count_7d: 0,
    violation_count_30d: 0,
  },
  {
    rule_id: 'ACCESS-003',
    memory_file: 'accessibility_rules.md',
    rule_text: 'Lighthouse accessibility score must be ≥ 95 on every build',
    current_enforcement: 'none',
    proposed_mechanism: 'build-runner-gate',
    is_advisory: false,
    enforcement_status: 'gap',
    violation_count_7d: 1,
    violation_count_30d: 4,
  },
  {
    rule_id: 'DOM-001',
    memory_file: 'domain_tagging.md',
    rule_text: 'Every entity must have at least one domain tag assigned',
    current_enforcement: 'none',
    proposed_mechanism: 'db-constraint',
    is_advisory: false,
    enforcement_status: 'gap',
    last_violated_at: '2026-04-22T06:30:00Z',
    violation_count_7d: 5,
    violation_count_30d: 17,
  },
  {
    rule_id: 'AWAY-001',
    memory_file: 'autonomy_rules.md',
    rule_text: 'Never send chat messages unless production is burning',
    current_enforcement: 'advisory',
    proposed_mechanism: 'advisory',
    is_advisory: true,
    enforcement_status: 'advisory',
    violation_count_7d: 0,
    violation_count_30d: 0,
  },
  {
    rule_id: 'AUTON-005',
    memory_file: 'autonomy_rules.md',
    rule_text: 'Questions are only permitted when the impact is irreversible',
    current_enforcement: 'advisory',
    proposed_mechanism: 'advisory',
    is_advisory: true,
    enforcement_status: 'advisory',
    violation_count_7d: 0,
    violation_count_30d: 0,
  },
  {
    rule_id: 'L-016',
    memory_file: 'learning_protocol.md',
    rule_text: 'After any failure, a new learning entry must be added',
    current_enforcement: 'advisory',
    proposed_mechanism: 'advisory',
    is_advisory: true,
    enforcement_status: 'advisory',
    violation_count_7d: 0,
    violation_count_30d: 0,
  },
  {
    rule_id: 'POKE-001',
    memory_file: 'pokerzeno_design.md',
    rule_text: 'Authoritative design direction must be followed for PokerZeno',
    current_enforcement: 'advisory',
    proposed_mechanism: 'advisory',
    is_advisory: true,
    enforcement_status: 'advisory',
    violation_count_7d: 0,
    violation_count_30d: 0,
  },
  {
    rule_id: 'BEHAV-001',
    memory_file: 'behavior_tests.md',
    rule_text: 'No feature ships without a passing behavior test',
    current_enforcement: 'gate:build-runner',
    proposed_mechanism: 'build-runner-gate',
    is_advisory: false,
    enforcement_status: 'enforced',
    violation_count_7d: 0,
    violation_count_30d: 2,
  },
];

function computeStats(rules: EnforcementRule[]): EnforcementStats {
  const mechanically_enforced = rules.filter(r => r.enforcement_status === 'enforced').length;
  const advisory = rules.filter(r => r.enforcement_status === 'advisory').length;
  const gap_count = rules.filter(r => r.enforcement_status === 'gap').length;
  const violations_7d = rules.reduce((s, r) => s + r.violation_count_7d, 0);
  const violations_30d = rules.reduce((s, r) => s + r.violation_count_30d, 0);

  const by_mechanism: Record<string, number> = {};
  for (const r of rules) {
    if (r.proposed_mechanism && r.proposed_mechanism !== 'advisory') {
      by_mechanism[r.proposed_mechanism] = (by_mechanism[r.proposed_mechanism] ?? 0) + 1;
    }
  }

  const most_violated = [...rules]
    .filter(r => r.violation_count_7d > 0 || r.violation_count_30d > 0)
    .sort((a, b) => b.violation_count_7d - a.violation_count_7d)
    .slice(0, 5);

  return {
    total_rules: rules.length,
    mechanically_enforced,
    advisory,
    gap_count,
    violations_7d,
    violations_30d,
    by_mechanism,
    most_violated,
  };
}

async function getEnforcementData(): Promise<{ rules: EnforcementRule[]; stats: EnforcementStats }> {
  // Mock data — replace with fetch('/api/enforcement') once the route exists
  const rules = MOCK_RULES;
  const stats = computeStats(rules);
  return { rules, stats };
}

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<EnforcementRule['enforcement_status'], { bg: string; color: string; label: string }> = {
  enforced: { bg: '#1c4532', color: '#68d391', label: 'enforced' },
  advisory: { bg: '#1a365d', color: '#63b3ed', label: 'advisory' },
  gap:      { bg: '#7b341e', color: '#fbd38d', label: 'gap' },
};

function StatusBadge({ status }: { status: EnforcementRule['enforcement_status'] }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 12,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        textTransform: 'uppercase',
      }}
    >
      {s.label}
    </span>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  color,
  subtitle,
}: {
  label: string;
  value: number | string;
  color: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: '16px 20px',
        flex: '1 1 140px',
        minWidth: 130,
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 6, fontWeight: 500 }}>{label}</div>
      {subtitle && (
        <div style={{ fontSize: 11, color: '#718096', marginTop: 3 }}>{subtitle}</div>
      )}
    </div>
  );
}

// ─── Mechanism bar chart ───────────────────────────────────────────────────────

const MECHANISM_COLORS: Record<string, string> = {
  'runtime-middleware': '#9f7aea',
  'build-runner-gate':  '#4299e1',
  'pre-commit-hook':    '#68d391',
  'db-constraint':      '#f6ad55',
  'eslint-rule':        '#fc8181',
  'contract-test':      '#76e4f7',
  'daemon':             '#faf089',
  'advisory':           '#718096',
};

function MechanismBreakdown({ by_mechanism }: { by_mechanism: Record<string, number> }) {
  const entries = Object.entries(by_mechanism).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div
      style={{
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: 20,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 16 }}>
        By mechanism
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map(([mechanism, count]) => {
          const barColor = MECHANISM_COLORS[mechanism] ?? '#718096';
          const pct = Math.round((count / max) * 100);
          return (
            <div key={mechanism} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 180,
                  fontSize: 12,
                  color: '#a0aec0',
                  fontFamily: 'monospace',
                  flexShrink: 0,
                  textAlign: 'right',
                  paddingRight: 4,
                }}
              >
                {mechanism}
              </div>
              <div
                style={{
                  flex: 1,
                  background: '#0f1117',
                  borderRadius: 4,
                  height: 14,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: barColor,
                    borderRadius: 4,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div
                style={{
                  width: 24,
                  fontSize: 12,
                  fontWeight: 700,
                  color: barColor,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {count}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Most violated table ──────────────────────────────────────────────────────

function MostViolatedTable({ rules }: { rules: EnforcementRule[] }) {
  if (rules.length === 0) {
    return (
      <div
        style={{
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>
          Most violated rules
        </div>
        <div style={{ color: '#4a5568', fontSize: 13, padding: '12px 0' }}>
          No violations recorded in the last 7 days.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: 20,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 16 }}>
        Most violated rules (last 7 days)
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2d3748' }}>
              {['Rule ID', 'Memory file', 'Rule', '7d', '30d', 'Last violated'].map(h => (
                <th
                  key={h}
                  style={{
                    padding: '6px 10px',
                    textAlign: 'left',
                    color: '#718096',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map(r => (
              <tr
                key={r.rule_id}
                style={{ borderBottom: '1px solid #1e2535' }}
              >
                <td
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#fbd38d',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.rule_id}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#a0aec0',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.memory_file}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    color: '#e2e8f0',
                    maxWidth: 300,
                  }}
                >
                  <span
                    title={r.rule_text}
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.rule_text.length > 60 ? r.rule_text.slice(0, 60) + '…' : r.rule_text}
                  </span>
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: r.violation_count_7d > 0 ? '#fc8181' : '#4a5568',
                  }}
                >
                  {r.violation_count_7d}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    textAlign: 'center',
                    color: r.violation_count_30d > 0 ? '#f6ad55' : '#4a5568',
                  }}
                >
                  {r.violation_count_30d}
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    color: '#718096',
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.last_violated_at
                    ? new Date(r.last_violated_at).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Full rules table ──────────────────────────────────────────────────────────

type FilterTab = 'all' | 'enforced' | 'advisory' | 'gap';

function RulesTable({ rules }: { rules: EnforcementRule[] }) {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let result = rules;

    if (activeTab !== 'all') {
      result = result.filter(r => r.enforcement_status === activeTab);
    }

    const q = search.toLowerCase().trim();
    if (q) {
      result = result.filter(
        r =>
          r.rule_id.toLowerCase().includes(q) ||
          r.rule_text.toLowerCase().includes(q) ||
          r.memory_file.toLowerCase().includes(q) ||
          r.proposed_mechanism.toLowerCase().includes(q),
      );
    }

    return result;
  }, [rules, activeTab, search]);

  const tabCounts: Record<FilterTab, number> = useMemo(
    () => ({
      all:      rules.length,
      enforced: rules.filter(r => r.enforcement_status === 'enforced').length,
      advisory: rules.filter(r => r.enforcement_status === 'advisory').length,
      gap:      rules.filter(r => r.enforcement_status === 'gap').length,
    }),
    [rules],
  );

  const TAB_LABELS: { key: FilterTab; label: string; activeColor: string }[] = [
    { key: 'all',      label: 'All',      activeColor: '#63b3ed' },
    { key: 'enforced', label: 'Enforced', activeColor: '#68d391' },
    { key: 'advisory', label: 'Advisory', activeColor: '#63b3ed' },
    { key: 'gap',      label: 'Gap',      activeColor: '#fbd38d' },
  ];

  return (
    <div
      style={{
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: 20,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 16 }}>
        All rules
      </div>

      {/* Toolbar: filter chips + search */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {TAB_LABELS.map(t => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                background: isActive ? '#2d3748' : 'transparent',
                color: isActive ? t.activeColor : '#718096',
                border: `1px solid ${isActive ? t.activeColor : '#2d3748'}`,
                borderRadius: 20,
                padding: '4px 14px',
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              aria-pressed={isActive}
            >
              {t.label}
              <span
                style={{
                  marginLeft: 6,
                  background: '#0f1117',
                  borderRadius: 10,
                  padding: '1px 6px',
                  fontSize: 10,
                  color: '#a0aec0',
                }}
              >
                {tabCounts[t.key]}
              </span>
            </button>
          );
        })}

        <input
          type="search"
          placeholder="Search rules..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search enforcement rules"
          style={{
            marginLeft: 'auto',
            background: '#0f1117',
            color: '#e2e8f0',
            border: '1px solid #2d3748',
            borderRadius: 6,
            padding: '5px 10px',
            fontSize: 12,
            width: 200,
            outline: 'none',
          }}
        />
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2d3748' }}>
              {['Rule ID', 'Memory file', 'Rule', 'Status', 'Proposed mechanism', 'Last violated'].map(
                h => (
                  <th
                    key={h}
                    style={{
                      padding: '7px 10px',
                      textAlign: 'left',
                      color: '#718096',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: '24px 10px',
                    textAlign: 'center',
                    color: '#4a5568',
                    fontSize: 13,
                  }}
                >
                  No rules match your filter.
                </td>
              </tr>
            )}
            {filtered.map((r, i) => (
              <tr
                key={r.rule_id}
                style={{
                  borderBottom: '1px solid #1e2535',
                  background: i % 2 === 0 ? 'transparent' : '#161b28',
                }}
              >
                <td
                  style={{
                    padding: '9px 10px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#90cdf4',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.rule_id}
                </td>
                <td
                  style={{
                    padding: '9px 10px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color: '#a0aec0',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.memory_file}
                </td>
                <td
                  style={{
                    padding: '9px 10px',
                    color: '#e2e8f0',
                    maxWidth: 320,
                  }}
                >
                  <span
                    title={r.rule_text}
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.rule_text.length > 80 ? r.rule_text.slice(0, 80) + '…' : r.rule_text}
                  </span>
                </td>
                <td style={{ padding: '9px 10px', whiteSpace: 'nowrap' }}>
                  <StatusBadge status={r.enforcement_status} />
                </td>
                <td
                  style={{
                    padding: '9px 10px',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    color:
                      MECHANISM_COLORS[r.proposed_mechanism] ?? '#a0aec0',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.proposed_mechanism}
                </td>
                <td
                  style={{
                    padding: '9px 10px',
                    color: '#718096',
                    fontSize: 11,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.last_violated_at
                    ? new Date(r.last_violated_at).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function EnforcementContent() {
  const { rules, stats } = useMemo(() => {
    const r = MOCK_RULES;
    return { rules: r, stats: computeStats(r) };
  }, []);

  const gapColor = stats.gap_count > 0 ? '#fbd38d' : '#68d391';
  const violationColor = stats.violations_7d > 0 ? '#fc8181' : '#68d391';

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          Enforcement Coverage
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#718096' }}>
          Memory rules &rarr; mechanical guardrails
        </p>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <KpiCard label="Total rules" value={stats.total_rules} color="#e2e8f0" />
        <KpiCard
          label="Mechanically enforced"
          value={stats.mechanically_enforced}
          color="#68d391"
          subtitle={`${Math.round((stats.mechanically_enforced / stats.total_rules) * 100)}% of total`}
        />
        <KpiCard
          label="Advisory"
          value={stats.advisory}
          color="#63b3ed"
          subtitle="best-effort only"
        />
        <KpiCard
          label="Gaps (need enforcement)"
          value={stats.gap_count}
          color={gapColor}
          subtitle={stats.gap_count > 0 ? 'action required' : 'all covered'}
        />
        <KpiCard
          label="Violations last 7d"
          value={stats.violations_7d}
          color={violationColor}
          subtitle={`${stats.violations_30d} in last 30d`}
        />
      </div>

      {/* Middle row: mechanism breakdown + most violated */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.8fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <MechanismBreakdown by_mechanism={stats.by_mechanism} />
        <MostViolatedTable rules={stats.most_violated} />
      </div>

      {/* Full rules table */}
      <RulesTable rules={rules} />
    </div>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function EnforcementPage() {
  return (
    <Suspense
      fallback={
        <div style={{ color: '#718096', padding: 32 }}>Loading enforcement data...</div>
      }
    >
      <EnforcementContent />
    </Suspense>
  );
}
