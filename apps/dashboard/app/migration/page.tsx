'use client';

/** Migration Strategy dashboard — tracks conductor-to-CAIA lift, launchd cutover, and architecture phases. */

const SOURCE_REPOS = [
  {
    repo: 'prakashgbid/conductor',
    status: 'merged',
    destination: 'apps/orchestrator/ + sub-apps + apps/dashboard/',
    prs: ['#48', '#50', '#51', '#52', '#53', '#54', '#55', '#56', '#57', '#58'],
    linesLifted: 16518,
    note: 'Conductor engine, all sub-apps, dashboard. 40 LIFT items across 10 PRs.',
  },
  {
    repo: 'prakashgbid/image-provider',
    status: 'merged',
    destination: 'packages/image-provider/ (@chiefaia/image-provider)',
    prs: ['#48'],
    linesLifted: null,
    note: 'Renamed, changeset added — will publish on next release.',
  },
  {
    repo: 'prakashgbid/conductor-state',
    status: 'archived',
    destination: '— (filesystem only at ~/.conductor/)',
    prs: [],
    linesLifted: null,
    note: 'State is filesystem-only; no repo needed.',
  },
  {
    repo: 'prakashgbid/framework',
    status: 'partial',
    destination: 'docs/legacy-framework/',
    prs: [],
    linesLifted: null,
    note: 'Governance docs/ADRs captured; repo archived.',
  },
  {
    repo: 'prakashgbid/pokerzeno-framework',
    status: 'partial',
    destination: 'docs/legacy-pokerzeno-framework/',
    prs: [],
    linesLifted: null,
    note: 'Same pattern as framework; repo archived.',
  },
  {
    repo: 'prakashgbid/pokerzeno-plugins',
    status: 'merged',
    destination: 'packages/{analytics,backend-core,cast-bridge,content-engine,dev-inspector,integrity-check,seo-program}/',
    prs: ['#48'],
    linesLifted: null,
    note: '7 sub-packages lifted; @pokerzeno/* scope retained.',
  },
  {
    repo: 'prakashgbid/site-template',
    status: 'merged',
    destination: 'templates/site/',
    prs: [],
    linesLifted: null,
    note: 'file:../* deps rewritten as workspace:*.',
  },
  {
    repo: 'prakashgbid/pokerzeno-site-template',
    status: 'merged',
    destination: 'templates/site-pokerzeno/',
    prs: [],
    linesLifted: null,
    note: 'Lifted as-is.',
  },
  {
    repo: 'conductor (plugins/)',
    status: 'merged',
    destination: 'apps/completeness-sentinel/ + packages/{secrets-broker,story-decomposer,dead-shell-detector,behavior-suite}/',
    prs: ['#57'],
    linesLifted: null,
    note: '@plugins/* scope rewritten to @chiefaia/*.',
  },
];

const LAUNCHD_JOBS = [
  {
    plist: 'com.conductor.executor',
    oldPath: 'conductor/dist/src/cli/index.js exec daemon',
    newPath: 'caia/apps/orchestrator/dist/src/cli/index.js exec daemon',
    status: 'pending',
  },
  {
    plist: 'com.conductor.mcp',
    oldPath: 'conductor/dist/cli/index.js mcp',
    newPath: 'caia/apps/orchestrator/dist/cli/index.js mcp',
    status: 'pending',
  },
  {
    plist: 'com.conductor.completeness-sentinel',
    oldPath: 'plugins/completeness-sentinel/dist/daemon.cjs',
    newPath: 'caia/apps/completeness-sentinel/dist/daemon.cjs',
    status: 'pending',
  },
  {
    plist: 'com.conductor.db-backup',
    oldPath: 'conductor/apps/db-backup/run-backup.sh',
    newPath: 'caia/apps/db-backup/run-backup.sh',
    status: 'pending',
  },
  {
    plist: 'com.conductor.story-backfiller',
    oldPath: 'conductor/apps/story-backfiller/index.cjs',
    newPath: 'caia/apps/story-backfiller/index.cjs',
    status: 'pending',
  },
  {
    plist: 'com.conductor.task-run-poller',
    oldPath: 'conductor/apps/task-run-poller/index.cjs',
    newPath: 'caia/apps/task-run-poller/index.cjs',
    status: 'pending',
  },
];

const ARCH_PHASES = [
  { phase: 0, label: 'Bootstrap', description: 'Monorepo structure established', status: 'done' },
  { phase: 1, label: 'Tier 1 Real Implementations', description: 'Wire logger, metrics, tracing, config, secrets', status: 'done' },
  { phase: 2, label: 'Domain Utilities', description: 'Pagination, search, cache; consolidation complete', status: 'done' },
  { phase: 3, label: 'AI Agent Primitives', description: 'agent-core, llm-client, tool-registry', status: 'in-progress' },
  { phase: 4, label: 'CAIA Core Orchestration', description: 'Conductor, workflow, memory', status: 'pending' },
  { phase: 5, label: 'CLI Full Implementation', description: 'Scaffolding, site generation', status: 'pending' },
  { phase: 6, label: 'Tier 5 Site Migration', description: 'pokerzeno, ROULETTECOMMUNITY, poker-247 consume @chiefaia/* from npm', status: 'pending' },
  { phase: 7, label: 'Documentation Site', description: 'chiefaia.com docs', status: 'pending' },
  { phase: 8, label: 'npm Publishing', description: 'All @chiefaia/* packages public', status: 'pending' },
  { phase: 9, label: 'Ecosystem Expansion', description: 'edisoncricket, ankitatiwari, prakash-tiwari', status: 'pending' },
];

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  merged: { bg: '#166534', color: '#bbf7d0', label: 'Merged' },
  archived: { bg: '#374151', color: '#9ca3af', label: 'Archived' },
  partial: { bg: '#78350f', color: '#fde68a', label: 'Partial' },
  pending: { bg: '#1e3a5f', color: '#93c5fd', label: 'Pending' },
  done: { bg: '#166534', color: '#bbf7d0', label: 'Done' },
  'in-progress': { bg: '#78350f', color: '#fde68a', label: 'In Progress' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? { bg: '#374151', color: '#9ca3af', label: status };
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 11,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 10,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>{title}</h2>
      {subtitle && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#718096' }}>{subtitle}</p>}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          background: '#2d3748',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: pct === 100 ? '#16a34a' : '#3b82f6',
            borderRadius: 3,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: '#9ca3af', minWidth: 36 }}>{pct}%</span>
    </div>
  );
}

export default function MigrationPage() {
  const mergedRepos = SOURCE_REPOS.filter((r) => r.status === 'merged' || r.status === 'archived' || r.status === 'partial').length;
  const donePhases = ARCH_PHASES.filter((p) => p.status === 'done').length;
  const cutoverDone = LAUNCHD_JOBS.filter((j) => j.status === 'done').length;

  return (
    <div style={{ maxWidth: 1100, paddingBottom: 48 }}>
      {/* Page header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#f0f4f8' }}>
          🚚 Migration Strategy
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#718096' }}>
          Conductor → CAIA lift status, launchd daemon cutover, and architectural roadmap.
        </p>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginBottom: 40,
        }}
      >
        {[
          {
            label: 'Source repos consolidated',
            value: `${mergedRepos} / ${SOURCE_REPOS.length}`,
            color: '#16a34a',
            pct: Math.round((mergedRepos / SOURCE_REPOS.length) * 100),
          },
          {
            label: 'Architecture phases complete',
            value: `${donePhases} / ${ARCH_PHASES.length}`,
            color: '#3b82f6',
            pct: Math.round((donePhases / ARCH_PHASES.length) * 100),
          },
          {
            label: 'Launchd jobs re-pointed',
            value: `${cutoverDone} / ${LAUNCHD_JOBS.length}`,
            color: cutoverDone === LAUNCHD_JOBS.length ? '#16a34a' : '#f59e0b',
            pct: Math.round((cutoverDone / LAUNCHD_JOBS.length) * 100),
          },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              background: '#1a1f2e',
              border: '1px solid #2d3748',
              borderRadius: 10,
              padding: '20px 24px',
            }}
          >
            <div style={{ fontSize: 13, color: '#718096', marginBottom: 8 }}>{card.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: card.color, marginBottom: 10 }}>
              {card.value}
            </div>
            <ProgressBar done={card.pct} total={100} />
          </div>
        ))}
      </div>

      {/* Architecture phases */}
      <div
        style={{
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 10,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <SectionHeader
          title="Architecture Roadmap"
          subtitle="9-phase plan from stub → production ecosystem"
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {ARCH_PHASES.map((phase, idx) => {
            const isLast = idx === ARCH_PHASES.length - 1;
            return (
              <div
                key={phase.phase}
                style={{
                  display: 'flex',
                  gap: 16,
                  paddingBottom: isLast ? 0 : 20,
                  position: 'relative',
                }}
              >
                {/* Timeline connector */}
                {!isLast && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 16,
                      top: 32,
                      bottom: 0,
                      width: 2,
                      background: phase.status === 'done' ? '#16a34a' : '#2d3748',
                    }}
                  />
                )}
                {/* Phase dot */}
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background:
                      phase.status === 'done'
                        ? '#166534'
                        : phase.status === 'in-progress'
                          ? '#78350f'
                          : '#1e3a5f',
                    border: `2px solid ${
                      phase.status === 'done'
                        ? '#16a34a'
                        : phase.status === 'in-progress'
                          ? '#f59e0b'
                          : '#2d3748'
                    }`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    color:
                      phase.status === 'done'
                        ? '#bbf7d0'
                        : phase.status === 'in-progress'
                          ? '#fde68a'
                          : '#93c5fd',
                    flexShrink: 0,
                    zIndex: 1,
                  }}
                >
                  {phase.status === 'done' ? '✓' : phase.phase}
                </div>
                <div style={{ paddingTop: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
                      Phase {phase.phase}: {phase.label}
                    </span>
                    <StatusBadge status={phase.status} />
                  </div>
                  <div style={{ fontSize: 13, color: '#9ca3af' }}>{phase.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Source repo lift table */}
      <div
        style={{
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 10,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <SectionHeader
          title="Source Repo Lift"
          subtitle="Status of each source repository consolidated into the CAIA monorepo"
        />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Repository', 'Status', 'Destination', 'PRs', 'Notes'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      color: '#718096',
                      fontWeight: 600,
                      borderBottom: '1px solid #2d3748',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SOURCE_REPOS.map((repo, i) => (
                <tr
                  key={repo.repo}
                  style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}
                >
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#90cdf4' }}>
                    {repo.repo}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <StatusBadge status={repo.status} />
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      color: '#9ca3af',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      maxWidth: 280,
                    }}
                  >
                    {repo.destination}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#9ca3af' }}>
                    {repo.prs.length > 0 ? repo.prs.join(', ') : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#718096', fontSize: 12 }}>
                    {repo.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Launchd cutover table */}
      <div
        style={{
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 10,
          padding: 24,
        }}
      >
        <SectionHeader
          title="Launchd Daemon Cutover"
          subtitle="Re-point launchd plists from /conductor/ and /plugins/ to /caia/apps/ — run scripts/migrate-launchd.sh"
        />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Plist', 'Status', 'Old path', 'New path'].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '8px 12px',
                      textAlign: 'left',
                      color: '#718096',
                      fontWeight: 600,
                      borderBottom: '1px solid #2d3748',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LAUNCHD_JOBS.map((job, i) => (
                <tr
                  key={job.plist}
                  style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}
                >
                  <td
                    style={{
                      padding: '10px 12px',
                      fontFamily: 'monospace',
                      color: '#90cdf4',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {job.plist}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <StatusBadge status={job.status} />
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: '#ef4444',
                    }}
                  >
                    {job.oldPath}
                  </td>
                  <td
                    style={{
                      padding: '10px 12px',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: '#34d399',
                    }}
                  >
                    {job.newPath}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            background: '#0f1117',
            borderRadius: 6,
            fontSize: 12,
            color: '#718096',
            fontFamily: 'monospace',
          }}
        >
          <span style={{ color: '#9ca3af' }}>Run: </span>
          <span style={{ color: '#fde68a' }}>bash scripts/migrate-launchd.sh --apply</span>
          <span style={{ color: '#9ca3af' }}> · Verify: </span>
          <span style={{ color: '#fde68a' }}>conductor pulse --json</span>
        </div>
      </div>
    </div>
  );
}
